import { describe, expect, it } from '@jest/globals';
import { BrevoSmsCreditCache, smsCreditFromAccount } from '../../../src/modules/notifications/adapters/brevo/brevo-sms-credit.util.js';

/*
 * El caso que originó todo esto, con la respuesta REAL de la cuenta de TEST el 2026-09-21:
 * `plan: [{type:"free", credits:300, creditsType:"sendLimit"}]`. Esos 300 son correos del plan
 * gratuito. Leerlos como saldo de SMS es exactamente lo que hizo que 25 envíos se dieran por buenos
 * mientras Brevo los descartaba uno a uno.
 */
const CUENTA_GRATUITA_SIN_SMS = { plan: [{ type: 'free', credits: 300, creditsType: 'sendLimit' }] };

describe('Saldo de SMS de Brevo', () => {
  it('300 créditos de correo NO son saldo de SMS', () => {
    expect(smsCreditFromAccount(CUENTA_GRATUITA_SIN_SMS)).toEqual({ canSend: false, credits: 0 });
  });

  it('reconoce la línea de SMS venga por `type` o por `creditsType`', () => {
    expect(smsCreditFromAccount({ plan: [{ type: 'sms', credits: 120 }] })).toEqual({ canSend: true, credits: 120 });
    expect(smsCreditFromAccount({ plan: [{ type: 'free', credits: 40, creditsType: 'sms' }] })).toEqual({ canSend: true, credits: 40 });
  });

  it('una línea de SMS a cero tampoco puede enviar', () => {
    expect(smsCreditFromAccount({ plan: [{ type: 'sms', credits: 0 }] })).toEqual({ canSend: false, credits: 0 });
  });

  it('suma las líneas de SMS cuando hay varias', () => {
    expect(
      smsCreditFromAccount({
        plan: [
          { type: 'sms', credits: 10 },
          { creditsType: 'sms', credits: 5 },
        ],
      }),
    ).toEqual({
      canSend: true,
      credits: 15,
    });
  });

  /*
   * La política es «bloquea sólo cuando lo sabe». Si Brevo cambia la forma de su respuesta, dejar de
   * mandar códigos sería un incidente peor que el que esta comprobación evita.
   */
  it('ante una respuesta que no se entiende deja pasar el envío', () => {
    for (const cuerpo of [null, undefined, {}, { plan: 'gratis' }, { plan: null }]) {
      expect(smsCreditFromAccount(cuerpo)).toEqual({ canSend: true, credits: null });
    }
  });
});

describe('Caché del saldo', () => {
  it('sirve el valor dentro de la ventana y lo olvida al pasarla', () => {
    const cache = new BrevoSmsCreditCache(1000);
    cache.write({ canSend: false, credits: 0 }, 10_000);
    expect(cache.read(10_500)).toEqual({ canSend: false, credits: 0 });
    expect(cache.read(11_000)).toBeNull();
  });

  it('cachea también el «no se pudo saber»: con Brevo caído no se insiste en cada envío', () => {
    const cache = new BrevoSmsCreditCache(1000);
    cache.write({ canSend: true, credits: null }, 0);
    expect(cache.read(500)).toEqual({ canSend: true, credits: null });
  });

  it('tras una recarga se vuelve a preguntar', () => {
    const cache = new BrevoSmsCreditCache(60_000);
    cache.write({ canSend: false, credits: 0 }, 0);
    cache.clear();
    expect(cache.read(1)).toBeNull();
  });
});
