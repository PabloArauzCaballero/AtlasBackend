/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Convierte el «quiero recibir novedades» en un consentimiento probable, no en una casilla suelta.
 * @system siembra el documento de consentimiento `marketing_communications`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const DOCUMENTS = `${atlasSchemaFor('consent_documents')}.consent_documents`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

const CODE = 'marketing_communications';

/**
 * El opt-in de marketing no era un consentimiento.
 *
 * La casilla «Quiero recibir novedades y promociones» viajaba como `marketingOptIn` y aterrizaba en
 * `customer_profile_versions.marketing_opt_in`: una columna booleana en la ficha del cliente. Los
 * otros tres —términos, privacidad e historial crediticio— sí van a `privacy.customer_consents`, con
 * su documento, su versión, su canal, su IP y su huella de dispositivo.
 *
 * ## Por qué importa la diferencia
 *
 * Un consentimiento de marketing hay que poder **probarlo y retirarlo**, y las dos cosas necesitan lo
 * mismo: saber QUÉ texto se aceptó, CUÁNDO y DESDE DÓNDE. La columna booleana no guarda nada de eso.
 * Ante un reclamo por publicidad no consentida, la respuesta disponible era «en la ficha dice true»,
 * que no acredita que a esa persona se le pidiera permiso, ni cuándo, ni con qué redacción. Y como
 * cada versión de perfil crea una fila nueva, el historial existía —pero como efecto colateral del
 * versionado del perfil, no como registro de consentimiento.
 *
 * ## Por qué `requires_explicit_action` es `false`
 *
 * A diferencia de los otros tres, este no bloquea el alta ni hay que leerlo para continuar: es
 * opcional de verdad. Marcarlo como explícito lo pondría en la lista de documentos obligatorios del
 * registro, que es justo lo contrario de lo que es.
 *
 * La columna `marketing_opt_in` se queda donde está: es la lectura rápida que usan el perfil y la
 * mensajería, y quitarla obligaría a consultar consentimientos en cada envío. Lo que cambia es cuál
 * de las dos es la fuente de verdad probatoria.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const body = [
    '## Qué autorizas',
    '',
    'Que Atlas te escriba para contarte novedades del producto, promociones de los comercios afiliados',
    'y beneficios de tu cuenta, por correo, WhatsApp o notificaciones de la app.',
    '',
    '## Qué NO incluye',
    '',
    'Los avisos de tus pagos, tus compras y tu cuenta llegan igual aunque no aceptes esto: no son',
    'publicidad, son información de tu crédito y no se pueden desactivar.',
    '',
    '## Puedes retirarlo cuando quieras',
    '',
    'Desde «Editar mis datos» en la app, sin dar explicaciones y sin que afecte a tu línea de crédito',
    'ni a las condiciones de tus cuotas.',
    '',
    '## Aviso',
    '',
    'Esta es una versión genérica en revisión legal.',
  ].join('\n');

  /* Se inserta sólo si falta: reejecutar la migración no puede duplicar el documento. */
  await queryInterface.sequelize.query(
    `
INSERT INTO ${DOCUMENTS} (
  _tenant_id, document_code, version_code, language, title, summary, body_md,
  content_url, requires_explicit_action, effective_from, status, _created_at
)
SELECT t._id, :code, 'v1', 'es', :title, :summary, :body, NULL, false, DATE '2026-08-23', 'published', NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${DOCUMENTS} d
  WHERE d._tenant_id = t._id AND d.document_code = :code AND d.version_code = 'v1' AND d.language = 'es'
);`,
    {
      replacements: {
        code: CODE,
        title: 'Novedades y promociones',
        summary: 'Nos autorizas a escribirte con novedades y promociones. Es opcional.',
        body,
      },
    },
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Sólo se retira el documento si NADIE lo aceptó todavía. Borrar un documento con consentimientos
   * colgando dejaría filas en `customer_consents` apuntando a una versión que ya no se puede leer, y
   * un consentimiento cuyo texto no se puede reconstruir no prueba nada.
   */
  await queryInterface.sequelize.query(
    `
DELETE FROM ${DOCUMENTS} d
 WHERE d.document_code = :code
   AND NOT EXISTS (
     SELECT 1 FROM ${atlasSchemaFor('customer_consents')}.customer_consents c
      WHERE c.consent_document_id = d._id
   );`,
    { replacements: { code: CODE } },
  );
}
