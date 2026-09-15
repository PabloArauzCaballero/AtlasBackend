/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Da a los roles internos el acceso a Flujos que el código ya exige.
 * @system reejecuta la sincronización convergente del catálogo RBAC para incorporar `systems.flows.*`.
 */
import { QueryInterface } from 'sequelize';
import { syncInternalRbacCatalog } from '../../modules/internal-users/internal-rbac.catalog-sync.js';

type MigrationContext = { context: QueryInterface };

/**
 * Flujos añade tres permisos a la lista canónica (`systems.flows.read`, `.analyze`, `.review`) y
 * los asigna a `SYSTEMS_ADMIN`, `DATA_GOVERNANCE_MANAGER`, `QA_ENGINEER` (sólo lectura) y, por
 * herencia de las acciones `read`, a `AUDITOR_READONLY`. Como los permisos se siembran por
 * migración y la última sincronización (`20260905050000`) ya corrió en toda base viva, sin esta
 * migración el ítem «Flujos» del portal existiría en el menú y nadie podría abrirlo: el mismo
 * defecto que dejó el expediente inalcanzable.
 *
 * Misma operación idempotente que las anteriores: recorre la lista entera, no sólo los tres de hoy.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await syncInternalRbacCatalog(queryInterface);
}

/**
 * No revierte: la convergencia no es un delta y no se puede saber qué filas existían antes.
 * Quitar permisos que el código exige rompería el catálogo de referencia, no lo devolvería.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
