/**
 * @file Re-export: el guard vive en `common/guards`; esta ruta se conserva para los importadores actuales.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system compatibilidad hacia atrás; el código nuevo importa desde `common/guards`.
 */
export { InternalPermissionsGuard } from '../../../common/guards/internal-permissions.guard.js';
