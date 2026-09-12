/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite que el cliente LEA lo que está aceptando, en vez de firmar a ciegas.
 * @system añade título y cuerpo al documento de consentimiento y siembra los tres genéricos.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const DOCUMENTS = `${atlasSchemaFor('consent_documents')}.consent_documents`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * El documento que se acepta no se podía leer.
 *
 * `consent_documents` guardaba `content_url` y `content_hash`: la dirección de un texto y su huella,
 * pero no el texto. La app pintaba una casilla con «Versión v1» y ningún sitio donde ver qué dice.
 * Es decir, se pedía un consentimiento informado sin la parte informada — que es justamente lo que
 * un consentimiento tiene que probar.
 *
 * ## Por qué el cuerpo va en la base y no detrás de la URL
 *
 * Porque el consentimiento se prueba con lo que la persona VIO. Una URL puede cambiar de contenido
 * sin cambiar de dirección, y entonces la versión aceptada deja de ser reconstruible; el `content_hash`
 * lo detectaría, pero detectar que la evidencia ya no existe no es lo mismo que conservarla.
 *
 * `content_url` se queda: sigue siendo útil para publicar el PDF firmado o la versión imprimible. Lo
 * que cambia es que deja de ser el ÚNICO sitio donde vive el texto.
 *
 * ## Editable desde operaciones
 *
 * El título y el cuerpo son texto de producto, no código. Que hoy haga falta desplegar el backend
 * para cambiar una palabra de la política es lo que lleva a que nadie la corrija nunca.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${DOCUMENTS}
  ADD COLUMN IF NOT EXISTS title    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS summary  TEXT,
  ADD COLUMN IF NOT EXISTS body_md  TEXT;`);

  await seedGenericDocuments(queryInterface);
}

/**
 * Los tres genéricos, para que el registro deje de pedir una firma en blanco.
 *
 * Son deliberadamente GENÉRICOS y así queda dicho en el propio texto: describen con honestidad lo
 * que Atlas hace hoy, y se editan desde el portal cuando Legal escriba los definitivos. Publicar un
 * texto provisional que se identifica como tal es mejor que publicar uno que aparenta ser final.
 */
async function seedGenericDocuments(queryInterface: QueryInterface): Promise<void> {
  const documents = [
    {
      code: 'terms_of_service',
      title: 'Términos y condiciones',
      summary: 'Qué es Atlas, qué te ofrece y qué esperamos de ti al usarlo.',
      body: [
        '## Qué es esto',
        '',
        'Atlas financia tus compras en los comercios afiliados: pagas una parte al comprar y el resto en',
        'cuotas. Al aceptar estos términos abres una cuenta y puedes solicitar crédito, que se aprueba o',
        'no según tu evaluación.',
        '',
        '## Lo que esperamos de ti',
        '',
        'Que los datos que declaras sean ciertos, que pagues tus cuotas en las fechas acordadas y que no',
        'uses la cuenta de otra persona ni prestes la tuya.',
        '',
        '## Lo que puedes esperar de nosotros',
        '',
        'Que te digamos siempre cuánto vas a pagar antes de confirmar una compra, que ningún cargo te',
        'sorprenda —todos están publicados— y que puedas cerrar tu cuenta cuando quieras si no tienes',
        'deuda pendiente.',
        '',
        '## Aviso',
        '',
        'Esta es una versión genérica en revisión legal. La versión definitiva se publicará aquí mismo y',
        'te pediremos que la aceptes de nuevo.',
      ].join('\n'),
      requiresExplicit: true,
    },
    {
      code: 'privacy_policy',
      title: 'Política de privacidad',
      summary: 'Qué datos guardamos, para qué los usamos y con quién los compartimos.',
      body: [
        '## Qué guardamos',
        '',
        'Tus datos de identidad y contacto, tu información económica declarada, las fotos de tu documento',
        'y el historial de tus compras y pagos con Atlas.',
        '',
        '## Para qué',
        '',
        'Para verificar que eres quien dices ser, para decidir si podemos darte crédito y cuánto, y para',
        'cobrar lo que se debe. No vendemos tus datos.',
        '',
        '## Con quién los compartimos',
        '',
        'Con el comercio donde compras, sólo lo necesario para que reconozca la operación —nunca tu',
        'historial ni tu calificación—. Y con las autoridades cuando la ley lo exige.',
        '',
        '## Tus derechos',
        '',
        'Puedes pedirnos ver lo que guardamos de ti, corregirlo si está mal, y pedir que lo borremos',
        'cuando ya no tengamos obligación legal de conservarlo.',
        '',
        '## Aviso',
        '',
        'Esta es una versión genérica en revisión legal.',
      ].join('\n'),
      requiresExplicit: true,
    },
    {
      code: 'credit_bureau_query',
      title: 'Consulta de tu historial crediticio',
      summary: 'Nos autorizas a consultar tu historial para decidir tu crédito.',
      body: [
        '## Qué autorizas',
        '',
        'Que Atlas consulte tu información en las centrales de información crediticia para evaluar tu',
        'solicitud, y que reporte el comportamiento de pago de tus créditos.',
        '',
        '## Por qué te lo pedimos aparte',
        '',
        'Porque es una autorización distinta de usar la app: puedes usar Atlas y no darla, aunque sin ella',
        'no podremos evaluarte para un crédito.',
        '',
        '## Aviso',
        '',
        'Esta es una versión genérica en revisión legal.',
      ].join('\n'),
      requiresExplicit: true,
    },
  ];

  for (const document of documents) {
    /*
     * Se actualiza si ya existe la versión y se inserta si no. Reejecutar la migración sobre una base
     * que ya la tenía no puede duplicar la casilla que el cliente ve en el registro.
     */
    await queryInterface.sequelize.query(
      `
INSERT INTO ${DOCUMENTS} (
  _tenant_id, document_code, version_code, language, title, summary, body_md,
  content_url, requires_explicit_action, effective_from, status, _created_at
)
SELECT t._id, :code, 'v1', 'es', :title, :summary, :body, NULL, :requiresExplicit, DATE '2026-08-21', 'published', NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${DOCUMENTS} d
  WHERE d._tenant_id = t._id AND d.document_code = :code AND d.version_code = 'v1' AND d.language = 'es'
);`,
      {
        replacements: {
          code: document.code,
          title: document.title,
          summary: document.summary,
          body: document.body,
          requiresExplicit: document.requiresExplicit,
        },
      },
    );

    await queryInterface.sequelize.query(
      `
UPDATE ${DOCUMENTS}
   SET title = :title, summary = :summary, body_md = :body, _updated_at = NOW()
 WHERE document_code = :code AND version_code = 'v1' AND language = 'es' AND title IS NULL;`,
      { replacements: { code: document.code, title: document.title, summary: document.summary, body: document.body } },
    );
  }

  /*
   * El sembrador de desarrollo dejo una `privacy-policy-dev` SIN titulo ni cuerpo, y es la unica que
   * la app veia. Se retira: convivir con la politica de verdad significaria dos politicas vigentes,
   * y la app elegiria por orden de consulta cual ensenar.
   */
  await queryInterface.sequelize.query(`
UPDATE ${DOCUMENTS}
   SET status = 'retired', effective_until = DATE '2026-08-21', _updated_at = NOW()
 WHERE document_code = 'privacy-policy-dev' AND status <> 'retired';`);
}

/**
 * No borra el texto.
 *
 * Quitar las columnas destruiría la evidencia de qué acepto cada persona, que es justamente lo que
 * un consentimiento existe para probar. Revertir un esquema no puede significar perder una prueba.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
