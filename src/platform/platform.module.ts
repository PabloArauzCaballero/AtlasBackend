/**
 * @file Módulo global de plataforma: puertos técnicos compartidos y sus adaptadores por defecto (AT-014).
 * @business Lo que todos los módulos necesitan y ninguno posee —el reloj, mañana el bus de eventos—
 *   se registra una vez y se sustituye en pruebas sin tocar los casos de uso.
 * @system `@Global()` para que `CLOCK` esté disponible sin importar el módulo en cada contexto.
 */
import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './di/clock.js';

@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class PlatformModule {}
