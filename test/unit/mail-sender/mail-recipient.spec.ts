import { describe, expect, it } from '@jest/globals';
import { isDeliverableAddress } from '../../../src/modules/mail-sender/mail-recipient.js';
import { resolveProductName } from '../../../src/modules/mail-sender/mail-product.js';

/**
 * Dos defectos que se veían desde la bandeja de entrada y no desde el código.
 *
 * El primero: los datos de semilla usan dominios reservados, el proveedor los acepta y los rebota,
 * y el rebote cae en el buzón real que firma los envíos. El segundo: la cabecera del correo decía
 * siempre «Plataforma de decisiones», así que un código pedido desde el ERP llegaba con el nombre
 * del motor y quien lo recibía no podía saber a qué portal se estaba entrando.
 */
describe('destinatarios de correo', () => {
  it('rechaza los dominios reservados que nunca van a resolver', () => {
    for (const address of [
      'pablo@atlas.internal',
      'ana@atlas.test',
      'x@atlas.local',
      'y@algo.invalid',
      'z@cualquiera.example',
    ]) {
      expect(isDeliverableAddress(address)).toBe(false);
    }
  });

  it('acepta un buzón real', () => {
    expect(isDeliverableAddress('a2020115468@estudiantes.upsa.edu.bo')).toBe(true);
    expect(isDeliverableAddress('ana@comercioalfa.bo')).toBe(true);
  });

  /* Una dirección malformada tampoco se entrega: sin dominio no hay nada que resolver. */
  it('rechaza lo que ni siquiera es una dirección', () => {
    for (const address of ['sin-arroba', '@solodominio.bo', 'usuario@', 'usuario@sinpunto']) {
      expect(isDeliverableAddress(address)).toBe(false);
    }
  });
});

describe('producto que firma el correo', () => {
  it('traduce cada portal a su nombre', () => {
    expect(resolveProductName('erp')).toBe('ERP corporativo');
    expect(resolveProductName('admin-portal')).toBe('Portal interno');
    expect(resolveProductName('decision-engine')).toBe('Plataforma de decisiones');
  });

  it('no refleja lo que llegue: el valor acaba impreso en un correo con la marca de ATLAS', () => {
    expect(resolveProductName('<script>alert(1)</script>')).toBeUndefined();
    expect(resolveProductName('Banco Falso S.A.')).toBeUndefined();
    expect(resolveProductName(undefined)).toBeUndefined();
  });

  it('tolera mayúsculas y espacios, que es como llegan las cabeceras de verdad', () => {
    expect(resolveProductName('  ERP  ')).toBe('ERP corporativo');
  });
});
