import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerLifecycleService } from '../../../src/modules/customers/application/customer-lifecycle.service.js';
import {
  ALLOWED_TRANSITIONS,
  CUSTOMER_LIFECYCLE_STATUSES,
  canTransition,
  normalizeLifecycleStatus,
} from '../../../src/modules/customers/customer-lifecycle.constants.js';

/**
 * `CustomerLifecycleService` es el ÚNICO componente autorizado a escribir
 * `customers.lifecycle_status`. Existe porque antes ese campo era texto libre nullable sin CHECK:
 * convivían once valores, cuatro de ellos leídos por medio backend y escritos por nadie, y la
 * decisión de un analista escribía el evento de historial SIN actualizar el estado del cliente.
 */
describe('CustomerLifecycleService', () => {
  function build() {
    const customer = { id: 'c1', lifecycleStatus: 'registered', updatedAtValue: null };
    const repository = {
      findForUpdate: jest.fn(async () => customer),
      applyStatus: jest.fn(async () => customer),
      createStatusEvent: jest.fn(async () => ({ id: 'ev1' })),
      // Patrón outbox: el evento de dominio se escribe en la MISMA transacción que el cambio de
      // estado, para que no exista un cambio sin evento ni un evento de un cambio revertido.
      createTransitionEvent: jest.fn(async () => ({ id: 'outbox-1' })),
    };
    const service = new CustomerLifecycleService(repository as never);
    return { service, repository, customer };
  }

  const baseInput = {
    tenantId: 't1',
    customerId: 'c1',
    reasonCode: 'contact_verified',
    changedByType: 'customer',
    transaction: {} as never,
  };

  it('lanza NotFoundException cuando el cliente no existe', async () => {
    const { service, repository } = build();
    (repository.findForUpdate as jest.Mock).mockResolvedValueOnce(null as never);
    await expect(service.transition({ ...baseInput, toStatus: 'onboarding_in_progress' })).rejects.toThrow(NotFoundException);
  });

  it('escribe estado e historial en la misma transacción, con el estado anterior REAL', async () => {
    const { service, repository, customer } = build();

    const result = await service.transition({ ...baseInput, toStatus: 'onboarding_in_progress', notes: 'ok' });

    expect(result).toMatchObject({ previousStatus: 'registered', newStatus: 'onboarding_in_progress', changed: true });
    expect(repository.applyStatus).toHaveBeenCalledWith(
      customer,
      { newStatus: 'onboarding_in_progress', now: expect.any(Date) },
      { transaction: {} },
    );
    // `previousStatus` NO puede volver a ser null: sin él, la cadena de estados no se reconstruye.
    expect((repository.createStatusEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
      previousStatus: 'registered',
      newStatus: 'onboarding_in_progress',
      reasonCode: 'contact_verified',
      notes: 'ok',
    });
    // Y el evento de dominio que dispara la notificación al cliente, en la misma transacción.
    expect((repository.createTransitionEvent as jest.Mock).mock.calls[0][0]).toMatchObject({
      previousStatus: 'registered',
      newStatus: 'onboarding_in_progress',
    });
  });

  it('rechaza una transición que la máquina de estados no permite', async () => {
    const { service, repository } = build();
    // registered -> active saltándose la revisión: exactamente lo que la máquina debe impedir.
    await expect(service.transition({ ...baseInput, toStatus: 'active' })).rejects.toThrow(UnprocessableEntityException);
    expect(repository.applyStatus).not.toHaveBeenCalled();
    expect(repository.createStatusEvent).not.toHaveBeenCalled();
  });

  it('es idempotente: repetir el estado actual no escribe estado ni evento', async () => {
    const { service, repository } = build();
    const result = await service.transition({ ...baseInput, toStatus: 'registered' });
    expect(result.changed).toBe(false);
    expect(repository.applyStatus).not.toHaveBeenCalled();
    expect(repository.createStatusEvent).not.toHaveBeenCalled();
    expect(repository.createTransitionEvent).not.toHaveBeenCalled();
  });

  it('advance descarta la transición ilegal sin romper el paso de negocio', async () => {
    const { service, repository } = build();
    const result = await service.advance({ ...baseInput, toStatus: 'active' });
    expect(result).toBeNull();
    expect(repository.applyStatus).not.toHaveBeenCalled();
  });

  it('advance propaga los errores que NO son de transición (no los traga)', async () => {
    const { service, repository } = build();
    (repository.findForUpdate as jest.Mock).mockRejectedValueOnce(new Error('db caída') as never);
    await expect(service.advance({ ...baseInput, toStatus: 'onboarding_in_progress' })).rejects.toThrow('db caída');
  });

  it('normaliza los valores heredados al conjunto canónico, y lo desconocido al estado más restrictivo', async () => {
    const { service, repository, customer } = build();
    customer.lifecycleStatus = 'pending_identity_review'; // valor previo a la migración
    const result = await service.transition({ ...baseInput, toStatus: 'active', reasonCode: 'approved' });
    expect(result.previousStatus).toBe('under_review');

    expect(normalizeLifecycleStatus('approved')).toBe('active');
    expect(normalizeLifecycleStatus('pending_more_information')).toBe('observed');
    expect(normalizeLifecycleStatus(null)).toBe('registered');
    expect(normalizeLifecycleStatus('valor-inventado')).toBe('registered');
    expect(repository).toBeDefined();
  });
});

describe('máquina de estados del cliente', () => {
  it('todo estado declarado tiene una entrada de transiciones', () => {
    for (const status of CUSTOMER_LIFECYCLE_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('todo destino declarado es a su vez un estado válido', () => {
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const target of targets) {
        expect(CUSTOMER_LIFECYCLE_STATUSES).toContain(target);
      }
    }
  });

  it('`closed` es terminal y `blocked`/`rejected` no vuelven directo a `active`', () => {
    expect(ALLOWED_TRANSITIONS.closed).toHaveLength(0);
    expect(canTransition('blocked', 'active')).toBe(false);
    expect(canTransition('rejected', 'active')).toBe(false);
    // Levantar un bloqueo obliga a volver a evaluar, no rehabilita de golpe.
    expect(canTransition('blocked', 'under_review')).toBe(true);
  });

  it('el único camino a `active` en el onboarding pasa por `under_review`', () => {
    const sources = CUSTOMER_LIFECYCLE_STATUSES.filter((status) => canTransition(status, 'active'));
    expect(sources.sort()).toEqual(['active', 'suspended', 'under_review']);
  });
});
