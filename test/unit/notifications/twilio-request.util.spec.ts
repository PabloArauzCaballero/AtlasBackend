import { describe, expect, it } from '@jest/globals';
import {
  toE164,
  twilioAuthHeader,
  twilioErrorDetails,
  twilioSender,
} from '../../../src/modules/notifications/adapters/twilio/twilio-request.util.js';

/**
 * Twilio sólo acepta E.164 y cobra el intento fallido. Estas reglas son las que evitan que un
 * teléfono guardado en formato nacional —lo normal en ATLAS— se convierta en un `21211` por mensaje.
 */
describe('toE164', () => {
  it('antepone el país a un número nacional y respeta el que ya viene internacional', () => {
    expect(toE164('70000000', '+591')).toBe('+59170000000');
    expect(toE164('+59170000000', '+591')).toBe('+59170000000');
    expect(toE164('(591) 7000-0000', '+591')).toBe('+59170000000');
    expect(toE164(' 591 70000000 ', '591')).toBe('+59170000000');
  });

  it('no recorta un número nacional que EMPIEZA por los dígitos del país', () => {
    // 5912345 son 7 dígitos: tratarlo como «+591 2345» inventaría un número que no existe.
    expect(toE164('5912345', '+591')).toBe('+5915912345');
  });

  it('descarta lo que no tiene forma de teléfono', () => {
    expect(toE164('12', '+591')).toBeNull();
    expect(toE164('', '+591')).toBeNull();
    expect(toE164(null, '+591')).toBeNull();
    expect(toE164('sin números', '+591')).toBeNull();
  });

  it('un destino internacional distinto del país por defecto se respeta', () => {
    expect(toE164('+13105550123', '+591')).toBe('+13105550123');
  });
});

describe('twilioSender', () => {
  it('el Messaging Service gana al número suelto: mandar los dos es un 400 de Twilio', () => {
    expect(twilioSender('+15550001111', 'MG123')).toEqual({ MessagingServiceSid: 'MG123' });
    expect(twilioSender('+15550001111', undefined)).toEqual({ From: '+15550001111' });
    expect(twilioSender('  ', '  ')).toBeNull();
  });
});

describe('twilioErrorDetails', () => {
  it('lee el código venga en el cuerpo directo o re-expuesto por el transporte', () => {
    expect(twilioErrorDetails({ code: 21211, message: "Invalid 'To' Phone Number" })).toEqual({
      code: '21211',
      message: "Invalid 'To' Phone Number",
      permanent: true,
    });
    expect(twilioErrorDetails({ providerResponse: { code: '21610', message: 'unsubscribed' } }).permanent).toBe(true);
  });

  it('un fallo de infraestructura NO es permanente: reintentarlo sí puede servir', () => {
    expect(twilioErrorDetails({ code: 30001, message: 'Queue overflow' }).permanent).toBe(false);
    expect(twilioErrorDetails(null)).toEqual({ code: null, message: null, permanent: false });
  });
});

describe('twilioAuthHeader', () => {
  it('arma el Basic con SID y token', () => {
    expect(twilioAuthHeader('AC1', 'tok')).toEqual({ authorization: `Basic ${Buffer.from('AC1:tok').toString('base64')}` });
  });
});
