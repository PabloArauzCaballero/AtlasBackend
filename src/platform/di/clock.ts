/**
 * @file Reloj inyectable (AT-014, AT-016).
 * @business Una decisión de negocio evaluada «ahora» tiene que poder reproducirse mañana con el mismo
 *   «ahora»; un `new Date()` escondido en el servicio lo impide.
 * @system Puerto mínimo + implementación de sistema + token estable para Nest. Los servicios lo
 *   reciben con `@Optional() @Inject(CLOCK)` y caen al reloj de sistema cuando se construyen a mano.
 */
export interface Clock {
  now(): Date;
}

/** Token de inyección estable en proceso (una interfaz TypeScript no existe en runtime). */
export const CLOCK = 'atlas.platform.clock';

export const systemClock: Clock = Object.freeze({ now: () => new Date() });

/** Reloj fijo para pruebas y reproducciones: devuelve siempre el mismo instante (copia defensiva). */
export function fixedClock(at: Date | string): Clock {
  const instant = new Date(at);
  return Object.freeze({ now: () => new Date(instant.getTime()) });
}
