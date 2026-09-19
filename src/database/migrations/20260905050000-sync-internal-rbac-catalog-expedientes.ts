/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Da a los roles internos el acceso al expediente de archivos que el código ya exige.
 * @system reejecuta la sincronización convergente del catálogo RBAC para incorporar los permisos de `expedientes`.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * El expediente estaba desplegado y era inalcanzable para todos.
 *
 * El módulo `expedientes` añadió cinco permisos (`expedientes.leer`, `.escribir`, `.compartir`,
 * `.administrar`, `.pii.revelar`) a la lista canónica del código y los asignó a ocho roles. Pero
 * esos permisos se siembran por migración, y la que sincroniza el catálogo
 * (`20260821040000-sync-internal-rbac-catalog`) **ya se había aplicado** antes de que existieran:
 * una migración corre una sola vez, así que en cualquier base viva el catálogo se quedó sin ellos.
 *
 * El efecto medido en el despliegue: `GET .../expedientes/:id/nodos/:id/contenido` respondía 404
 * `EXPEDIENTE_NO_ENCONTRADO` **incluso para un admin**. No era un fallo del guard: sin el permiso en
 * la base, el nivel efectivo sobre cualquier carpeta es `null`, y el guard traduce «no puede verlo»
 * a un 404 para no delatar la existencia del expediente a quien no debe. La función se instaló pero
 * nadie podía abrir un archivo.
 *
 * Esta migración vuelve a converger el catálogo. Es la misma operación idempotente de la anterior
 * —`ON CONFLICT DO UPDATE` en el catálogo, `DO NOTHING` en las concesiones—, factorizada en
 * `syncInternalRbacCatalog`, así que recorre la lista entera y no sólo los cinco de hoy: la próxima
 * vez que el código gane un permiso hará falta otra migración como ésta, pero ninguna dejará el
 * catálogo a medias.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncInternalRbacCatalog(queryInterface);
}

/**
 * No revierte, por lo mismo que la sincronización anterior: la convergencia no es un delta y no se
 * puede saber qué filas existían antes. Quitar permisos que el código exige devolvería la API al
 * 404 del que esta migración la saca. Deshacer un catálogo de referencia es romperlo, no volver.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
