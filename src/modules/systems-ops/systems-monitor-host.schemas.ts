/**
 * @file Contrato de la instantánea del servidor que manda el informador.
 * @business Lo que el portal enseña en «Servidor de TEST»: memoria, disco, carga, caché de build, copia de
 *   bases y el estado de cada app con su respaldo. Son números del host, nunca datos de clientes.
 * @system Validación estricta (`.strict()`, listas acotadas): el emisor es un servicio de confianza, pero
 *   la ruta no pasa por el guard de sesión y no debe aceptar cuerpos arbitrarios.
 */
import { z } from 'zod';

const appStateSchema = z.object({
  name: z.string().min(1).max(60),
  principal: z.string().min(1).max(20),
  respaldo: z.string().min(1).max(20).nullable(),
  memoryPct: z.number().min(0).max(1000).nullable(),
});

export const hostSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime(),
    ramAvailableMb: z.number().nonnegative(),
    ramTotalMb: z.number().positive(),
    swapFreeMb: z.number().nonnegative(),
    swapTotalMb: z.number().nonnegative(),
    load1: z.number().nonnegative(),
    load15: z.number().nonnegative(),
    cores: z.number().int().positive().max(1024),
    diskPct: z.number().min(0).max(100),
    buildCacheGb: z.number().nonnegative(),
    backupAgeHours: z.number().nonnegative().nullable(),
    apps: z.array(appStateSchema).max(40),
  })
  .strict();

export type HostSnapshotDto = z.infer<typeof hostSnapshotSchema>;
