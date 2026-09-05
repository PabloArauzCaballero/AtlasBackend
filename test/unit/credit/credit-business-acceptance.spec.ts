import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
/** El dueño del expediente 77, y otro comercio cualquiera del mismo tenant. */
const MERCHANT_OWNER = { sub: 'mu-1', role: 'merchant', merchantUserId: 'm1' } as never;
const MERCHANT_OTHER = { sub: 'mu-2', role: 'merchant', merchantUserId: 'm2' } as never;

function build(applicationOverrides: AnyRecord | null, ownerMerchantUserId?: string) {
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
  /*
   * El expediente del comercio, para la comprobación de propiedad. Sólo se consulta cuando el actor
   * es `merchant`: personal interno decide sin pasar por aquí.
   */
  const partnerProfiles = {
    requireProfile: jest.fn(async (..._a: unknown[]) => ({ id: '77', ownerMerchantUserId: ownerMerchantUserId ?? 'm1' })),
  };
  const service = new CreditBusinessAcceptanceService(credit as never, partnerProfiles as never, sequelize as never);
  return { service, application, credit, events, partnerProfiles };
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

  /*
   * Lo que abre la aceptación al portal del comercio, y el filo que la hace segura. El rol
   * `merchant` ya no basta: hay que ser el dueño del expediente donde nació la solicitud. Sin esta
   * comprobación, cualquier comercio autenticado podría aceptar —o rechazar— las compras de otro.
   */
  it('el comercio dueño puede decidir sobre lo suyo', async () => {
    const { service, application } = build({ partnerProfileId: '77' }, 'm1');

    const result = await service.decide({
      tenantId: '1',
      applicationId: '5',
      body: { accepted: true },
      currentUser: MERCHANT_OWNER,
    });

    expect(result.businessAcceptance).toBe('accepted');
    expect(application?.status).toBe('approved');
  });

  it('un comercio ajeno no puede decidir sobre una solicitud que no nació en su local', async () => {
    const { service } = build({ partnerProfileId: '77' }, 'm1');

    await expect(
      service.decide({ tenantId: '1', applicationId: '5', body: { accepted: true }, currentUser: MERCHANT_OTHER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /*
   * Las solicitudes anteriores al vínculo no tienen comercio, y no se pueden repartir por defecto:
   * dejar que cualquiera las tomara permitiría a un comercio quedarse con operaciones que no
   * originó. Quedan para personal interno, que sí puede averiguar de dónde vinieron.
   */
  it('una solicitud sin comercio no la decide ningún comercio', async () => {
    const { service } = build({ partnerProfileId: null }, 'm1');

    await expect(
      service.decide({ tenantId: '1', applicationId: '5', body: { accepted: true }, currentUser: MERCHANT_OWNER }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Y el personal interno sigue pudiendo, que es el camino de soporte cuando el comercio no responde.
    const interno = build({ partnerProfileId: null }, 'm1');
    await expect(
      interno.service.decide({ tenantId: '1', applicationId: '5', body: { accepted: true }, currentUser: ACTOR }),
    ).resolves.toMatchObject({ businessAcceptance: 'accepted' });
  });
});
