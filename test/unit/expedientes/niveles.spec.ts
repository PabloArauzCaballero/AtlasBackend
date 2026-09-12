import { describe, expect, it } from '@jest/globals';
import { NIVELES, alcanza, nivelMayor, type Nivel } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * Los cuatro niveles y su orden.
 *
 * Se fija aquí porque TODA la autorización del explorador se apoya en que `alcanza` y `nivelMayor`
 * digan lo mismo en cualquier orden de comparación. Un `nivelMayor` que no fuera conmutativo haría
 * que el nivel efectivo dependiera de en qué orden llegan las concesiones de la base — un fallo
 * que sólo aparecería con dos concesiones sobre el mismo nodo y que nadie sabría reproducir.
 */
describe('niveles del expediente', () => {
  it('cada nivel incluye a los anteriores y ninguno a los siguientes', () => {
    expect(alcanza('administrar', 'leer')).toBe(true);
    expect(alcanza('compartir', 'escribir')).toBe(true);
    expect(alcanza('escribir', 'leer')).toBe(true);
    expect(alcanza('leer', 'escribir')).toBe(false);
    expect(alcanza('escribir', 'compartir')).toBe(false);
    expect(alcanza('compartir', 'administrar')).toBe(false);
  });

  it('sin nivel no se alcanza nada: `null` no es «el más bajo»', () => {
    // Es la diferencia entre «no tiene permiso» y «tiene el permiso mínimo». Con `null` tratado
    // como `leer`, cualquiera con sesión interna vería la carpeta de cualquier cliente.
    for (const requerido of NIVELES) expect(alcanza(null, requerido)).toBe(false);
  });

  it('nivelMayor es conmutativo y trata `null` como ausencia', () => {
    for (const a of NIVELES) {
      for (const b of NIVELES) expect(nivelMayor(a, b)).toBe(nivelMayor(b, a));
      expect(nivelMayor(a, null)).toBe(a);
      expect(nivelMayor(null, a)).toBe(a);
    }
    expect(nivelMayor(null, null)).toBeNull();
  });

  it('el orden declarado es el que la autorización asume', () => {
    // Si alguien reordena el arreglo, `escribir` podría pasar a incluir `administrar` sin que
    // ninguna otra prueba lo note.
    const esperado: Nivel[] = ['leer', 'escribir', 'compartir', 'administrar'];
    expect([...NIVELES]).toEqual(esperado);
  });
});
