import { describe, expect, it, jest } from '@jest/globals';
import { LoanPaymentClaimsService } from '../../../src/modules/loan-payment-claims/loan-payment-claims.service.js';
import { CARPETA_POR_TIPO } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * El comprobante de pago tiene que aparecer en el expediente del cliente.
 *
 * El aviso de pago escribía la evidencia en `evidence_documents` y en el almacén, pero NO llamaba
 * al gancho del expediente: el archivo existía y la carpeta del cliente no lo enseñaba. Quien
 * abría el expediente veía el carnet y el extracto, y del pago nada — sin ningún error por medio,
 * que es lo que hizo que pasara desapercibido.
 *
 * Se prueba desde el servicio y no desde el gancho porque lo que faltaba era la LLAMADA, no el
 * gancho: un test del gancho habría estado en verde todo el tiempo.
 */

type Registro = Record<string, unknown>;

function construir() {
  const expedienteHooks = { alRegistrarEvidencia: jest.fn(async (..._a: unknown[]) => undefined) };
  const eventos: Registro[] = [];

  const service = new LoanPaymentClaimsService(
    /* sequelize */ { transaction: jest.fn(async (fn: never) => (fn as unknown as (t: unknown) => unknown)({})) } as never,
    /* claims */ {
      findOne: jest.fn(async () => null),
      create: jest.fn(async (valores: never) => ({
        ...(valores as object),
        id: '900',
        claimCode: 'PC-1',
        status: 'pending',
        submittedAt: new Date(),
      })),
    } as never,
    /* storage */ {
      isConfigured: () => true,
      getBucket: () => 'atlas-evidencias',
      readObjectMetadata: jest.fn(async () => ({ sha256Hex: 'abc123', sizeBytes: 4096 })),
    } as never,
    /* evidences */ { create: jest.fn(async (valores: never) => ({ ...(valores as object), id: '77' })) } as never,
    /* events */ { publish: jest.fn(async (e: never) => void eventos.push(e as Registro)) } as never,
    /* contexto */ {
      requireOwnInstallment: jest.fn(async () => ({
        loan: { id: '5', currencyCode: 'BOB', creditApplicationId: null },
        installment: { id: '11', loanId: '5', status: 'pending' },
      })),
      resolvePartner: jest.fn(async () => null),
    } as never,
    expedienteHooks as never,
  );

  return { service, expedienteHooks, eventos };
}

const entrada = {
  tenantId: '1',
  customerId: '24',
  body: { installmentId: '11', amount: '150.00', contentType: 'image/jpeg', storageKey: 'files/1/24/payment_proof/x.jpg', sizeBytes: 4096 },
  currentUser: { role: 'customer', customerId: '24' },
} as never;

describe('El comprobante de pago entra en el expediente', () => {
  it('registra la evidencia en el expediente al avisar del pago', async () => {
    const { service, expedienteHooks } = construir();

    await service.submit(entrada);

    expect(expedienteHooks.alRegistrarEvidencia).toHaveBeenCalledTimes(1);
    expect(expedienteHooks.alRegistrarEvidencia).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        customerId: '24',
        documentType: 'payment_proof',
        storageKey: 'files/1/24/payment_proof/x.jpg',
        sha256: 'abc123',
        mimeType: 'image/jpeg',
        sizeBytes: '4096',
      }),
    );
  });

  /*
   * El gancho va DESPUÉS del commit y después del evento, no dentro de la transacción.
   *
   * El gancho se traga sus errores a propósito, así que meterlo dentro no rompería nada visible;
   * lo que haría es atar el aviso de pago —el compromiso con el cliente— al explorador de
   * archivos, y dejar el registro del pago sin escribir si el catálogo tuviera un mal día.
   */
  it('el aviso de pago ya está escrito y publicado cuando se toca el expediente', async () => {
    const { service, expedienteHooks, eventos } = construir();
    let eventosAlLlamarAlGancho = -1;
    expedienteHooks.alRegistrarEvidencia.mockImplementationOnce(async () => {
      eventosAlLlamarAlGancho = eventos.length;
    });

    await service.submit(entrada);

    expect(eventosAlLlamarAlGancho).toBe(1);
    expect(eventos[0]?.eventCode).toBe('payment.reported');
  });

  it('el comprobante tiene su propia carpeta y no cae en «otros»', () => {
    expect(CARPETA_POR_TIPO.payment_proof).toEqual({ carpeta: 'pagos', clase: 'payment_proof', nombre: 'comprobante de pago' });
  });
});
