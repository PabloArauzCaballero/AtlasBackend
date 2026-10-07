/**
 * @file Re-export: el decorador vive en `common/decorators`; esta ruta se conserva para los importadores actuales.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system compatibilidad hacia atrás; el código nuevo importa desde `common/decorators`.
 */
export { INTERNAL_PERMISSIONS_KEY, InternalPermissions } from '../../common/decorators/internal-permissions.decorator.js';
