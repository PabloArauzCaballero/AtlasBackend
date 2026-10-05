/**
 * @file El QR de cobro por caja lleva freno propio.
 * @business `POST /merchant-qr/payment` recibe ids secuenciales de comercio y caja: sólo con el límite
 *   global se podía recorrerlos y juntar la cuenta de cobro de todos los comercios aprobados.
 * @system Propiedad estática del controlador: se lee la metadata de `@Throttle`, como en
 *   `public-auth-throttle.spec.ts`.
 */
import { describe, expect, it } from '@jest/globals';
import 'reflect-metadata';
import { MerchantQrController } from '../../../src/modules/partner-onboarding/merchant-qr.controller.js';

describe('MerchantQrController · freno del QR de cobro', () => {
  it('payment limita las consultas por minuto por debajo del límite global', () => {
    const handler = (MerchantQrController.prototype as unknown as Record<string, unknown>).payment as object;
    const limite = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as number | undefined;
    const ventana = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as number | undefined;

    expect(typeof limite).toBe('number');
    expect(typeof ventana).toBe('number');
    expect(Math.ceil(((limite as number) * 60_000) / (ventana as number))).toBeLessThanOrEqual(20);
  });
});
