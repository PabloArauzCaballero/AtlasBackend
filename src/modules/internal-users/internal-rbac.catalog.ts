/**
 * @file El catálogo de permisos internos, compuesto de sus cuatro grupos.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system compone la lista de permisos que se siembra en la base.
 */
import type { InternalPermissionSeed } from './internal-rbac.permission-builder.js';
import { PLATFORM_PERMISSION_SEEDS } from './internal-rbac.catalog.platform.js';
import { PEOPLE_PERMISSION_SEEDS } from './internal-rbac.catalog.people.js';
import { DATA_PERMISSION_SEEDS } from './internal-rbac.catalog.data.js';
import { RECORDS_PERMISSION_SEEDS } from './internal-rbac.catalog.records.js';

/**
 * La lista entera llegó a 500 líneas y no tiene techo: crece con cada pantalla nueva. Se reparte en
 * lo que se opera del sistema, quién entra, qué se ve del dato y quién abre un expediente — y se
 * vuelve a juntar aquí, para que nadie tenga que saber en cuál de los cuatro cayó un permiso.
 */
export const INTERNAL_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  ...PLATFORM_PERMISSION_SEEDS,
  ...PEOPLE_PERMISSION_SEEDS,
  ...DATA_PERMISSION_SEEDS,
  ...RECORDS_PERMISSION_SEEDS,
];
