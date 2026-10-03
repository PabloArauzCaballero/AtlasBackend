/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business La bienvenida de la app explica primero qué es Atlas y cómo funciona, con una ilustración por paso, y ese texto se edita desde el portal.
 * @system siembra `onboarding/que-es-atlas` si falta y nombra la ilustración (`metadata_json.ilustracion`) de los tres pasos de siempre.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

const QUE_ES_ATLAS = {
  key: 'que-es-atlas',
  title: 'Qué es Atlas',
  subtitle:
    'Atlas te da crédito para comprar en los comercios de tu barrio, sin que un banco decida por ti. Pagas después, en cuotas mensuales, y cada pago a tiempo te acerca a más límite.',
  metadata: { ilustracion: 'que-es-atlas' },
} as const;

/** Las ilustraciones de los pasos que ya existían. La app las deduce por clave si falta, así que esto sólo lo hace explícito. */
const ILUSTRACIONES: ReadonlyArray<readonly [key: string, ilustracion: string]> = [
  ['paso-1', 'escaneas-y-listo'],
  ['paso-2', 'pagas-en-cuotas'],
  ['paso-3', 'construyes-historial'],
];

/**
 * Sólo si falta, como las demás siembras de contenido: reejecutar no pisa lo que alguien ya corrigió en el
 * portal, y el `NOT EXISTS` no mira `_deleted` para no resucitar una pieza retirada.
 *
 * `order` 0, igual que el eslogan: la app descarta el eslogan de la lista de pasos y deja «Qué es Atlas» el
 * primero. A los pasos existentes sólo se les AÑADE la clave `ilustracion` a `metadata_json`; su texto no se toca.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, display_order, is_active, published_at, _created_at
)
SELECT t._id, 'onboarding', :key, 'es-BO', :title, :subtitle, NULL,
       NULL, CAST(:metadata AS JSONB), 0, TRUE, NOW(), NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${TABLE} e
  WHERE e._tenant_id = t._id AND e.surface = 'onboarding' AND e.content_key = :key AND e.locale = 'es-BO'
);`,
    {
      replacements: {
        key: QUE_ES_ATLAS.key,
        title: QUE_ES_ATLAS.title,
        subtitle: QUE_ES_ATLAS.subtitle,
        metadata: JSON.stringify(QUE_ES_ATLAS.metadata),
      },
    },
  );

  for (const [key, ilustracion] of ILUSTRACIONES) {
    await queryInterface.sequelize.query(
      `
UPDATE ${TABLE}
   SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('ilustracion', CAST(:ilustracion AS TEXT))
 WHERE surface = 'onboarding'
   AND content_key = :key
   AND (metadata_json IS NULL OR NOT (metadata_json ? 'ilustracion'));`,
      { replacements: { key, ilustracion } },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // Sólo «Qué es Atlas» tal cual se sembró (`_updated_at` igual a `_created_at`): si alguien la editó en el portal es suya.
  await queryInterface.sequelize.query(
    `DELETE FROM ${TABLE} WHERE surface = 'onboarding' AND content_key = :key AND _updated_at = _created_at;`,
    { replacements: { key: QUE_ES_ATLAS.key } },
  );
  for (const [key] of ILUSTRACIONES) {
    await queryInterface.sequelize.query(
      `UPDATE ${TABLE} SET metadata_json = metadata_json - 'ilustracion' WHERE surface = 'onboarding' AND content_key = :key;`,
      { replacements: { key } },
    );
  }
}
