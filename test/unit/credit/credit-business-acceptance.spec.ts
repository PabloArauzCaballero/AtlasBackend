import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreditBusinessAcceptanceService } from '../../../src/modules/credit/application/credit-business-acceptance.service.js';
import { creditBusinessAcceptanceSchema } from '../../../src/modules/credit/credit.schemas.js';

/**
 * La segunda pregunta: el motor dice si el riesgo encaja, el negocio dice si quiere la operación.
 *
 * Faltaba entera. El motor aprobaba, la solicitud quedaba en `approved` —estado cerrado— y el
 * endpoint de decisión manual respondía `CREDIT_APPLICATION_ALREADY_DECIDED`: el motor no proponía,
 * disponía. Lo que se fija aquí es que ahora se pueda responder, y que responder no contamine la
 * medición del propio motor.
 */

type AnyRecord = Record<string, unknown>;

const ACTOR = { sub: 'usr-1', role: 'admin', internalUserId: '9' } as never;

function build(applicationOverrides: AnyRecord | null) {
  const events: AnyRecord[] = [];
  const application =
    applicationOverrides === null
      ? null
      : ({
          status: 'approved',
          businessAcceptance: 'pending',
          decisionMode: 'decision_engine',
          decisionExecutionId: 'exec-1',
          decisionReasonCode: 'ENGINE_OK',
          save: jest.fn(async (..._a: unknown[]) => undefined),
          ...applicationOverrides,
        } as AnyRecord);
  const credit = {
    findApplicationById: jest.fn(async (..._a: unknown[]) => application),
    createApplicationEvent: jest.fn(async (...args: unknown[]) => {
      events.push(args[0] as AnyRecord);
      return {} as AnyRecord;
    }),
  };
  // La transacción se ejecuta en línea: lo que importa es la regla, no el aislamiento.
  const sequelize = { transaction: jest.fn(async (fn: never) => (fn as (t: unknown) => unknown)(undefined)) };
  const service = new CreditBusinessAcceptanceService(credit as never, sequelize as never);
  return { service, application, credit, events };
}

describe('creditBusinessAcceptanceSchema', () => {
  /*
   * Declinar exige motivo y aceptar no, y la asimetría es deliberada: el motivo de aceptar ya lo
   * dio el motor; una operación declinada sin explicación es la que se reclama medio año después.
   */
  it('exige motivo para declinar y no para aceptar', () => {
    expect(creditBusinessAcceptanceSchema.safeParse({ accepted: true }).success).toBe(true);
    expect(creditBusinessAcceptanceSchema.safeParse({ accepted: false }).success).toBe(false);
    expect(creditBusinessAcceptanceSchema.safeParse({ accepted: false, reasonCode: 'CUPO_AGOTADO' }).success).toBe(true);
  });
});

describe('CreditBusinessAcceptanceService', () => {
  it('acepta una aprobación del motor sin tocar su estado', async () => {
    const { service, application, events } = build({});

    const result = await service.decide({
      tenantId: '1',
      applicationId: '5',
      body: { accepted: true },
      currentUser: ACTOR,
    });

    expect(result.businessAcceptance).toBe('accepted');
    // Aceptar no cambia el estado: ya estaba aprobada, y la aceptación es otra dimensión.
    expect(application?.status).toBe('approved');
    expect(events[0]?.eventType).toBe('business_acceptance_recorded');
  });

  /*
   * Declinar sí mueve el estado: para el solicitante el desenlace es el mismo —no hay crédito— y
   * dejarlo en `approved` publicaría una aprobación que nadie va a honrar.
   */
  it('declinar deja la solicitud rechazada, con su motivo', async () => {
    const { service, application } = build({});

    const result = await service.decide({
      tenantId: '1',
      applicationId: '5',
      body: { accepted: false, reasonCode: 'CUPO_AGOTADO', notes: 'Sin cupo hasta el próximo ciclo.' },
      currentUser: ACTOR,
    });

    expect(result.businessAcceptance).toBe('declined');
    expect(application?.status).toBe('rejected');
    expect(application?.businessAcceptanceReasonCode).toBe('CUPO_AGOTADO');
  });

  /*
   * Y la parte que hace medible al motor: declinar por cupo NO reescribe el motivo del motor. Si lo
   * pisara, sus aprobaciones declinadas por razones comerciales contarían como errores suyos y la
   * calibración del modelo quedaría envenenada.
   */
  it('no reescribe el motivo que dictó el motor', async () => {
    const { service, application, events } = build({});

    await service.decide({
      tenantId: '1',
      applicationId: '5',
      body: { accepted: false, reasonCode: 'CONCENTRACION' },
      currentUser: ACTOR,
    });

    expect(application?.decisionReasonCode).toBe('ENGINE_OK');
    expect((events[0]?.payloadJson as AnyRecord)?.engineExecutionId).toBe('exec-1');
  });

  /* Sin esta puerta, aceptar dos veces produciría dos desembolsos sobre la misma aprobación. */
  it('una solicitud ya resuelta no se vuelve a aceptar', async () => {
    const { service } = build({ businessAcceptance: 'accepted' });

    await expect(
      service.decide({ tenantId: '1', applicationId: '5', body: { accepted: true }, currentUser: ACTOR }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /*
   * Una aprobación firmada por una persona no lleva `pending`: ya trae dentro la voluntad del
   * negocio, y pedir una segunda aceptación sería pedir dos veces lo mismo.
   */
  it('no aplica sobre una aprobación que no venía del motor', async () => {
    const { service } = build({ businessAcceptance: null, decisionMode: 'manual' });

    await expect(
      service.decide({ tenantId: '1', applicationId: '5', body: { accepted: true }, currentUser: ACTOR }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('una solicitud inexistente no se decide', async () => {
    const { service } = build(null);

    await expect(
      service.decide({ tenantId: '1', applicationId: '404', body: { accepted: true }, currentUser: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
