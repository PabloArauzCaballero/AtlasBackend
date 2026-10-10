/**
 * @file Guarda la contraseña generada del administrador de desarrollo en un archivo propio, no en la salida.
 * @business Una contraseña en claro en los logs de un contenedor la lee cualquiera con acceso a ellos.
 * @system define database para sembrar PostgreSQL de forma controlada fuera de producción.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Escribe la contraseña en un archivo NUEVO (`wx`: nunca pisa otro) con permisos 600 en el directorio
 * temporal del sistema y devuelve su ruta. La salida (consola o logs del contenedor) sólo muestra la
 * ruta: imprimir el valor dejaría la credencial en los logs (CodeQL js/clear-text-logging).
 */
export function saveGeneratedAdminPassword(password: string, directory: string = tmpdir()): string {
  const file = join(directory, `atlas-dev-admin-${process.pid}-${Date.now()}.txt`);
  writeFileSync(file, `${password}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}
