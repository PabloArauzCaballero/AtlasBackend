import { describe, expect, it } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { SupportActorService } from '../../../src/modules/support/application/support-actor.service.js';
import type { SupportActor } from '../../../src/modules/support/application/support-actor.service.js';

/**
 * El servicio sólo necesita sus dos colaboradores para resolver un actor desde un token; la
 * comprobación de audiencia es una regla pura y no toca ninguno de los dos.
 */
const actors = new SupportActorService(null as never, null as never);

function actor(overrides: Partial<SupportActor>): SupportActor {
  return {
    actorType: 'CUSTOMER',
    actorId: 'cust-1',
    customerId: '1',
    isInternal: false,
    isSupervisor: false,
    ...overrides,
  } as SupportActor;
}

const consumidor = actor({ actorType: 'CUSTOMER' });
const comercio = actor({ actorType: 'PARTNER_USER', customerId: null, actorId: 'pu-1' });
const interno = actor({ actorType: 'AGENT', customerId: null, actorId: 'ag-1', isInternal: true });

const categoria = (categoryCode: string, audience: string) => ({ categoryCode, audience });

/**
 * La audiencia de la categoría no es una etiqueta de presentación.
 *
 * Arrastra cola, sensibilidad, impacto y urgencia por defecto, y el código de categoría viaja en el
 * cuerpo de la petición. Sin esta comprobación un consumidor podía abrir su caso con el motivo de
 * conciliación del comercio y aterrizar en `partner_operations`: delante de los expedientes de los
 * comercios y fuera de la cola de quien debía atenderle.
 */
describe('audiencia del motivo al abrir o reclasificar', () => {
  it('el consumidor puede usar motivos de consumo', () => {
    expect(() => actors.assertCategoryAllowed(consumidor, categoria('PAYMENT_PROOF_NOT_RECOGNIZED', 'CONSUMER'))).not.toThrow();
  });

  it('el consumidor NO puede usar un motivo del comercio', () => {
    expect(() => actors.assertCategoryAllowed(consumidor, categoria('PARTNER_RECONCILIATION', 'PARTNER_USER'))).toThrow(ForbiddenException);
  });

  it('el usuario del comercio NO puede usar un motivo de consumo', () => {
    expect(() => actors.assertCategoryAllowed(comercio, categoria('KYC_VERIFICATION', 'CONSUMER'))).toThrow(ForbiddenException);
  });

  it('el usuario del comercio alcanza también lo de su organización', () => {
    expect(() => actors.assertCategoryAllowed(comercio, categoria('PARTNER_FORMAL_COMPLAINT', 'PARTNER_ORGANIZATION'))).not.toThrow();
  });

  /** Queja, fraude y consulta genérica son de cualquiera: negárselos sería peor que el problema. */
  it('los motivos de audiencia ANY los alcanzan todos', () => {
    for (const quien of [consumidor, comercio, interno]) {
      expect(() => actors.assertCategoryAllowed(quien, categoria('COMPLAINT', 'ANY'))).not.toThrow();
      expect(() => actors.assertCategoryAllowed(quien, categoria('FRAUD_REPORT', 'ANY'))).not.toThrow();
    }
  });

  /**
   * Al agente no se le limita: mover un caso entre audiencias es su trabajo, y es exactamente lo que
   * hay que hacer cuando alguien abrió por el motivo equivocado.
   */
  it('el agente interno alcanza cualquier audiencia, incluida la interna', () => {
    for (const audiencia of ['CONSUMER', 'PARTNER_USER', 'PARTNER_ORGANIZATION', 'INTERNAL', 'ANY']) {
      expect(() => actors.assertCategoryAllowed(interno, categoria('X', audiencia))).not.toThrow();
    }
  });

  it('el error dice que el motivo no está permitido, no que no exista', () => {
    try {
      actors.assertCategoryAllowed(consumidor, categoria('PARTNER_BILLING', 'PARTNER_USER'));
      throw new Error('debió rechazar');
    } catch (error) {
      // Decir «no encontrado» mandaría a quien integra a buscar un error de catálogo que no hay.
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'SUPPORT_CATEGORY_NOT_ALLOWED',
        categoryCode: 'PARTNER_BILLING',
      });
    }
  });
});
