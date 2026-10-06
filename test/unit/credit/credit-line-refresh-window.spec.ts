import { describe, expect, it } from '@jest/globals';
import { pickWindow } from '../../../src/modules/credit/application/credit-line-refresh.service.js';

/**
 * La ventana del refresco. Un cliente que el Motor no resuelve sigue «sin línea» y, con un corte fijo, volvía a
 * ocupar su sitio cada hora: con `limit` clientes así nadie más se recalculaba. Rotar el comienzo lo evita.
 */
describe('pickWindow', () => {
  const cola = Array.from({ length: 120 }, (_, i) => i);

  it('con menos clientes que el tope, pasan todos y en su orden', () => {
    expect(pickWindow([1, 2, 3], 50, 7)).toEqual([1, 2, 3]);
  });

  it('la primera pasada atiende el comienzo de la cola (los «sin línea» primero)', () => {
    expect(pickWindow(cola, 50, 0)).toEqual(cola.slice(0, 50));
  });

  it('un cliente al final de una cola de 120 llega a la ventana en pocas pasadas, aunque los 50 primeros no se resuelvan', () => {
    const vistos = new Set<number>();
    for (let hora = 0; hora < 3; hora += 1) for (const c of pickWindow(cola, 50, hora)) vistos.add(c);
    expect(vistos.size).toBe(120);
    expect(vistos.has(119)).toBe(true);
  });

  it('cada ventana tiene exactamente `limit` clientes distintos', () => {
    for (let hora = 0; hora < 10; hora += 1) {
      const ventana = pickWindow(cola, 50, hora);
      expect(ventana).toHaveLength(50);
      expect(new Set(ventana).size).toBe(50);
    }
  });
});
