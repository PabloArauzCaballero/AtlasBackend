import { describe, expect, it } from '@jest/globals';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_RESOLUTION_CODE_LABELS,
  SUPPORT_RESOLUTION_CODES,
  SUPPORT_ROOT_CAUSE_CODE_LABELS,
  SUPPORT_ROOT_CAUSE_CODES,
} from '../../../src/modules/support/support.constants.js';

/**
 * El catálogo de códigos viaja al frontend por HTTP en vez de copiarse allí.
 *
 * Estas pruebas cuidan la única forma en que ese contrato se puede romper en silencio: que alguien
 * añada un código a la lista y olvide su descripción. La consola lo pintaría vacío y el agente
 * elegiría a ciegas justo el campo con el que después se mide la operación.
 */
describe('catálogo de códigos de soporte', () => {
  it('cada código de resolución tiene descripción, y no sobra ninguna', () => {
    expect(Object.keys(SUPPORT_RESOLUTION_CODE_LABELS).sort()).toEqual([...SUPPORT_RESOLUTION_CODES].sort());
  });

  it('cada causa raíz tiene descripción, y no sobra ninguna', () => {
    expect(Object.keys(SUPPORT_ROOT_CAUSE_CODE_LABELS).sort()).toEqual([...SUPPORT_ROOT_CAUSE_CODES].sort());
  });

  it('cada prioridad dice a qué compromete', () => {
    expect(Object.keys(SUPPORT_PRIORITY_LABELS).sort()).toEqual([...SUPPORT_PRIORITIES].sort());
  });

  it('ninguna descripción está vacía ni es el propio código repetido', () => {
    const todas = { ...SUPPORT_RESOLUTION_CODE_LABELS, ...SUPPORT_ROOT_CAUSE_CODE_LABELS, ...SUPPORT_PRIORITY_LABELS };
    for (const [code, label] of Object.entries(todas)) {
      expect(label.trim().length).toBeGreaterThan(10);
      expect(label).not.toBe(code);
    }
  });

  /**
   * `UNKNOWN` es el default de la columna y el código que hay que vigilar: su descripción tiene que
   * decir que se cierra igual, para que nadie lo lea como «pendiente de investigar».
   */
  it('UNKNOWN se describe como una decisión medida, no como un hueco', () => {
    expect(SUPPORT_ROOT_CAUSE_CODE_LABELS.UNKNOWN).toContain('No se determinó');
  });
});
