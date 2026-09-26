import { describe, expect, it } from '@jest/globals';
import { closeCaseSchema, resolveCaseSchema } from '../../../src/modules/support/support-case.schemas.js';
import { SUPPORT_RESOLUTION_CODES, SUPPORT_ROOT_CAUSE_CODES } from '../../../src/modules/support/support.constants.js';

const valido = {
  resolutionCode: 'USER_GUIDANCE',
  rootCauseCode: 'THIRD_PARTY',
  customerResolution: 'Tu operador estaba rechazando el SMS; ya probamos y el código llega.',
  internalResolution: 'Confirmado con el proveedor: filtrado en la ruta del operador.',
};

/**
 * Estos dos códigos son la razón de ser del expediente cerrado.
 *
 * Un valor fuera de catálogo no rompe ninguna consulta: se cuela en el informe de causas como una
 * categoría más, con su fila y su porcentaje, y nadie distingue «doscientos casos por un defecto de
 * la app» de «doscientos casos por algo que alguien tecleó mal». La analítica no falla ruidosamente
 * cuando se contamina; da otro número y sigue.
 */
describe('esquema de resolución', () => {
  it('acepta una resolución completa con códigos del catálogo', () => {
    expect(resolveCaseSchema.parse(valido).resolutionCode).toBe('USER_GUIDANCE');
  });

  it('rechaza un código de resolución que no existe', () => {
    expect(resolveCaseSchema.safeParse({ ...valido, resolutionCode: 'RESUELTO' }).success).toBe(false);
  });

  it('rechaza una causa raíz que no existe', () => {
    expect(resolveCaseSchema.safeParse({ ...valido, rootCauseCode: 'SE_ARREGLO_SOLO' }).success).toBe(false);
  });

  it('acepta todos los códigos declarados, para que la constante y el esquema no se separen', () => {
    for (const resolutionCode of SUPPORT_RESOLUTION_CODES) {
      expect(resolveCaseSchema.safeParse({ ...valido, resolutionCode }).success).toBe(true);
    }
    for (const rootCauseCode of SUPPORT_ROOT_CAUSE_CODES) {
      expect(resolveCaseSchema.safeParse({ ...valido, rootCauseCode }).success).toBe(true);
    }
  });

  /**
   * Admitir «no lo sé» es honesto; el default es lo que lo vuelve invisible.
   *
   * La causa raíz puede quedarse en `UNKNOWN` al cerrar —fingir que se conoce es peor—, pero al ser
   * el valor por defecto se escribe también cuando nadie se hizo la pregunta. Sin un proceso que la
   * complete después, el cien por cien de los casos acaba en `UNKNOWN` y la gestión de problemas se
   * queda sin materia prima.
   */
  it('deja la causa raíz en UNKNOWN cuando no se declara', () => {
    const { rootCauseCode, ...sinCausa } = valido;
    expect(rootCauseCode).toBeDefined();
    expect(resolveCaseSchema.parse(sinCausa).rootCauseCode).toBe('UNKNOWN');
  });

  it('exige las dos versiones: la del cliente y la interna', () => {
    expect(resolveCaseSchema.safeParse({ ...valido, customerResolution: '' }).success).toBe(false);
    expect(resolveCaseSchema.safeParse({ ...valido, internalResolution: '' }).success).toBe(false);
  });

  it('exige un motivo con contenido al cerrar', () => {
    expect(closeCaseSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(closeCaseSchema.safeParse({ reason: 'Confirmado por el cliente.' }).success).toBe(true);
  });
});
