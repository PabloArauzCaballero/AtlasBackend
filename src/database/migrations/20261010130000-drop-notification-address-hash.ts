/**
 * @file Migración de datos: quita `addressHash` (SHA-256 sin clave del destino) de `notification_messages.delivery_targets_json`.
 * @business Un SHA-256 de un móvil boliviano se revierte en segundos: guardarlo sin que nadie lo lea sólo deja teléfonos recuperables en la base y sus respaldos.
 * @system recorre por lotes las filas cuyo JSON aún trae la clave y la elimina de cada destino; idempotente; el `down` no la recrea.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = `"${atlasSchemaFor('notification_messages')}".notification_messages`;
const LOTE = 2000;

/**
 * Sólo toca filas que aún tienen la clave (`jsonb_path_exists`), así que reaplicarla o retomarla tras un corte no
 * reescribe nada más. El orden y el resto de campos de cada destino (`kind`, `addressEncrypted`, `last4`) se
 * conservan. La columna es JSONB sin CHECK: no hace falta ampliar ninguna restricción (§3 de CLAUDE.md).
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  let total = 0;
  for (;;) {
    const [, affected] = (await queryInterface.sequelize.query(
      `UPDATE ${TABLA} AS m
          SET delivery_targets_json = (
                SELECT jsonb_agg(CASE WHEN jsonb_typeof(t.elem) = 'object' THEN t.elem - 'addressHash' ELSE t.elem END ORDER BY t.ord)
                  FROM jsonb_array_elements(m.delivery_targets_json) WITH ORDINALITY AS t(elem, ord)
              )
        WHERE m.ctid IN (
                SELECT ctid FROM ${TABLA}
                 WHERE delivery_targets_json IS NOT NULL
                   AND jsonb_typeof(delivery_targets_json) = 'array'
                   AND jsonb_path_exists(delivery_targets_json, '$[*].addressHash')
                 LIMIT ${String(LOTE)}
              )`,
      { type: QueryTypes.UPDATE },
    )) as unknown as [unknown, number];
    total += affected;
    if (affected < LOTE) break;
  }
  console.log(`[notification-address-hash] ${String(total)} mensajes sin addressHash.`);
}

/**
 * No hay vuelta atrás que valga: recrear el SHA-256 exigiría descifrar cada destino y volver a guardar justo lo que
 * esta migración quita. El código anterior tampoco lo leía, así que volver a él con estas filas funciona igual.
 */
export async function down(_context: MigrationContext): Promise<void> {
  await Promise.resolve();
}
