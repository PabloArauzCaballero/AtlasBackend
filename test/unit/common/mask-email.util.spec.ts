import { describe, expect, it } from '@jest/globals';
import { maskEmailForDisplay } from '../../../src/common/utils/contact/mask-email.util.js';

/**
 * Se enseña un correo a su dueño sin entregarlo entero: lo justo para reconocerlo («es mi gmail») y nada más.
 */
describe('maskEmailForDisplay', () => {
  it('deja el dominio y los dos primeros caracteres', () => {
    expect(maskEmailForDisplay('pablo.arauz@gmail.com')).toBe('pa***@gmail.com');
  });

  it('con una parte local corta sólo deja el primero: dos de tres sería enseñar casi todo', () => {
    expect(maskEmailForDisplay('ana@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmailForDisplay('jo@x.bo')).toBe('j***@x.bo');
  });

  it('con cuatro o más caracteres ya deja dos', () => {
    expect(maskEmailForDisplay('juan@atlas.bo')).toBe('ju***@atlas.bo');
  });

  it('no pierde un subdominio ni un «+» del dominio', () => {
    expect(maskEmailForDisplay('maria@estudiantes.upsa.edu.bo')).toBe('ma***@estudiantes.upsa.edu.bo');
  });

  it('recorta espacios alrededor', () => {
    expect(maskEmailForDisplay('  pablo@gmail.com ')).toBe('pa***@gmail.com');
  });

  it('lo que no parece un correo no enseña nada, ni basura', () => {
    expect(maskEmailForDisplay(null)).toBeNull();
    expect(maskEmailForDisplay(undefined)).toBeNull();
    expect(maskEmailForDisplay('')).toBeNull();
    expect(maskEmailForDisplay('sin-arroba')).toBeNull();
    expect(maskEmailForDisplay('@gmail.com')).toBeNull();
    expect(maskEmailForDisplay('pablo@')).toBeNull();
  });

  it('nunca devuelve la parte local completa', () => {
    for (const correo of ['pablo.arauz@gmail.com', 'ana@gmail.com', 'juan@atlas.bo', 'x@y.z']) {
      const local = correo.split('@')[0] as string;
      expect(maskEmailForDisplay(correo)?.split('@')[0]).not.toBe(local);
    }
  });
});
