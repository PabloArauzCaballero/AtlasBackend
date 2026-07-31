/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';

export type BuildInfo = {
  /** Versión semántica del artefacto desplegado. */
  version: string;
  /** Commit exacto del que se construyó la imagen, si el pipeline lo inyectó. */
  commit: string | null;
  /** Momento de construcción de la imagen, si el pipeline lo inyectó. */
  builtAt: string | null;
};

/**
 * Identidad del artefacto que está corriendo.
 *
 * Hallazgo A-05 de `docs/audit/auditoria-integral-2026-07-30.md`: `/health` leía
 * `process.env['npm_package_version']`, que SOLO existe cuando el proceso lo lanza `yarn`/`npm` al
 * ejecutar un script. El arranque productivo documentado es `node dist/src/main.js`, donde esa
 * variable no está definida — así que producción respondía siempre el literal `'0.1.0'` y no había
 * forma de saber qué build estaba desplegado.
 *
 * Orden de resolución, del más fiable al menos:
 *  1. `APP_VERSION` — la inyecta el pipeline al construir la imagen. Es la única fuente que sigue
 *     siendo correcta si el `package.json` no viaja en la imagen.
 *  2. `npm_package_version` — correcta cuando se arranca con `yarn start`.
 *  3. `package.json` del directorio de trabajo — el caso normal de un contenedor con WORKDIR en la
 *     raíz de la app.
 *  4. `0.0.0-unknown` — explícitamente desconocida, nunca un número inventado que parezca real.
 *
 * Se calcula UNA vez al importar: es información inmutable del proceso y `/health` es un endpoint de
 * sondeo que se llama con mucha frecuencia.
 */
function readVersionFromPackageJson(): string | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim().length > 0 ? parsed.version : null;
  } catch {
    return null;
  }
}

function resolveBuildInfo(): BuildInfo {
  const version = env.APP_VERSION ?? process.env['npm_package_version'] ?? readVersionFromPackageJson() ?? '0.0.0-unknown';
  return {
    version,
    commit: env.APP_COMMIT_SHA ?? null,
    builtAt: env.APP_BUILT_AT ?? null,
  };
}

export const buildInfo: BuildInfo = resolveBuildInfo();
