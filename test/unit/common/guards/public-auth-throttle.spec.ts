/**
 * @file Todo endpoint público que prueba credenciales lleva su propio freno de fuerza bruta.
 * @business El login del portal interno abre los veinte roles y sus permisos; el del comercio, la
 *   operación de un afiliado. Sin freno propio sólo los cubría el límite global de 100 peticiones
 *   por minuto y por IP, que para probar contraseñas no es un freno: son 144.000 intentos al día
 *   contra una sola cuenta, sin que nada lo distinga del tráfico normal.
 * @system Propiedad ESTÁTICA del controlador —qué metadata de throttler cuelga de cada método—, así
 *   que se afirma leyendo los decoradores, sin levantar Nest ni Redis. Es la misma forma que usa
 *   `controller-auth-coverage.spec.ts` para los guards.
 */
import { describe, expect, it } from '@jest/globals';
import 'reflect-metadata';
import { AuthController } from '../../../../src/modules/auth/auth.controller.js';
import { InternalAuthController } from '../../../../src/modules/internal-users/internal-auth.controller.js';
import { MerchantAuthController } from '../../../../src/modules/merchant-identity/merchant-auth.controller.js';

/**
 * `@Throttle({ default: { ttl, limit } })` guarda cada campo en su propia clave de metadata, con el
 * nombre del throttler PEGADO al final: `THROTTLER:LIMITdefault`. No es un objeto bajo una sola
 * clave, que es lo que uno espera al leer el decorador.
 */
const CLAVE_LIMITE = 'THROTTLER:LIMITdefault';
const CLAVE_VENTANA = 'THROTTLER:TTLdefault';

type Metodo = { controlador: new (...args: never[]) => object; nombre: string; metodo: string; tope: number };

/**
 * Los tres logins del sistema y los dos segundos factores. El `limit` que se fija aquí es el techo
 * MÁXIMO aceptable: subirlo es aflojar el freno y esta prueba lo convierte en una decisión explícita.
 */
const PROTEGIDOS: Metodo[] = [
  { controlador: AuthController, nombre: 'clientes', metodo: 'login', tope: 10 },
  { controlador: InternalAuthController, nombre: 'portal interno', metodo: 'login', tope: 10 },
  { controlador: InternalAuthController, nombre: 'portal interno (PIN)', metodo: 'verifyLoginPin', tope: 10 },
  { controlador: MerchantAuthController, nombre: 'comercios', metodo: 'login', tope: 10 },
];

function limitePorMinuto(controlador: Metodo['controlador'], metodo: string): number | null {
  const prototipo = controlador.prototype as Record<string, unknown>;
  const handler = prototipo[metodo];
  if (typeof handler !== 'function') return null;
  const limite = Reflect.getMetadata(CLAVE_LIMITE, handler) as number | undefined;
  const ventana = Reflect.getMetadata(CLAVE_VENTANA, handler) as number | undefined;
  if (typeof limite !== 'number' || typeof ventana !== 'number') return null;
  // Se normaliza a «por minuto» para poder comparar topes escritos con ventanas distintas.
  return Math.ceil((limite * 60_000) / ventana);
}

describe('freno de fuerza bruta en los endpoints públicos de credenciales', () => {
  it.each(PROTEGIDOS)('el login de $nombre limita los intentos por minuto', ({ controlador, metodo, tope }) => {
    const limite = limitePorMinuto(controlador, metodo);
    expect(limite).not.toBeNull();
    expect(limite as number).toBeLessThanOrEqual(tope);
  });

  it('rotar la sesión también tiene techo propio, aunque más holgado', () => {
    for (const controlador of [InternalAuthController, MerchantAuthController]) {
      const limite = limitePorMinuto(controlador, 'refresh');
      expect(limite).not.toBeNull();
      expect(limite as number).toBeLessThanOrEqual(30);
    }
  });
});
