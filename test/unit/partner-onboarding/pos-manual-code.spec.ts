import {
  POS_MANUAL_CODE_ALPHABET,
  POS_MANUAL_CODE_LENGTH,
  formatPosManualCode,
  generatePosManualCode,
  normalizePosManualCode,
} from '../../../src/modules/partner-onboarding/application/pos-manual-code.js';

describe('código manual de una caja', () => {
  it('genera 8 caracteres del alfabeto sin confusiones (0/O, 1/I/L, U/V)', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generatePosManualCode();
      expect(code).toHaveLength(POS_MANUAL_CODE_LENGTH);
      for (const char of code) expect(POS_MANUAL_CODE_ALPHABET).toContain(char);
    }
    expect(POS_MANUAL_CODE_ALPHABET).not.toMatch(/[01OILUV]/);
  });

  it('no repite códigos en una tanda razonable', () => {
    const vistos = new Set(Array.from({ length: 2000 }, () => generatePosManualCode()));
    expect(vistos.size).toBe(2000);
  });

  it('acepta lo que alguien teclea: minúsculas, espacios y guion', () => {
    expect(normalizePosManualCode('k7m2-9qxd')).toBe('K7M29QXD');
    expect(normalizePosManualCode('  K7M2 9QXD ')).toBe('K7M29QXD');
    expect(normalizePosManualCode('K7M29QXD')).toBe('K7M29QXD');
  });

  it('rechaza lo que no puede ser un código de caja', () => {
    expect(normalizePosManualCode('K7M29QX')).toBeNull(); // corto
    expect(normalizePosManualCode('K7M29QXDD')).toBeNull(); // largo
    expect(normalizePosManualCode('K7M2-9QX0')).toBeNull(); // 0 no existe en el alfabeto
    expect(normalizePosManualCode('SN-1789065299579-RMWUCC')).toBeNull(); // un serial
  });

  it('se imprime en dos mitades', () => {
    expect(formatPosManualCode('K7M29QXD')).toBe('K7M2-9QXD');
    expect(normalizePosManualCode(formatPosManualCode('K7M29QXD'))).toBe('K7M29QXD');
  });
});
