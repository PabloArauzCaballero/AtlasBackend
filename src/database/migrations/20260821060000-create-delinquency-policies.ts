/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza fija por escrito qué pasa cuando alguien se atrasa, y de dónde sale cada regla.
 * @system crea el catálogo versionado de políticas de mora e intereses y siembra su primera versión.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const POLICIES = `${atlasSchemaFor('delinquency_policies')}.delinquency_policies`;

/**
 * Lo que pasa cuando alguien se atrasa, escrito y versionado.
 *
 * La app tiene que decirle al cliente qué le va a ocurrir si no paga —y ese texto es lo que después
 * se le opone cuando reclama—. Escribirlo en la pantalla lo convierte en una cadena que cambia con
 * cada publicación de la app, sin fecha de vigencia y sin forma de saber qué versión aceptó cada
 * persona. Aquí vive versionado: quien firmó bajo la v1 se le juzga por la v1.
 *
 * ## `source_kind` es la columna que más importa
 *
 * Separa **lo que manda la norma** de **lo que decide Atlas**. La distinción no es documental: una
 * regla regulatoria no se puede negociar con el cliente y una comercial sí, y confundirlas lleva a
 * dos errores caros — presentar como ley algo que es política propia (que es engañoso), o relajar
 * por atención al cliente algo que el regulador exige (que es una infracción).
 *
 * Las reglas marcadas `atlas` llevan `source_reference` vacío A PROPÓSITO cuando no se pudo
 * contrastar el artículo exacto de la Recopilación de Normas para Servicios Financieros. Preferimos
 * declararlas política propia y que Legal las promueva a regulatorias con la cita en la mano, antes
 * que atribuirle a ASFI un umbral que no verificamos.
 *
 * ## Los tramos van en JSONB
 *
 * Son una lista corta que se lee entera siempre —la pantalla los pinta todos— y que cambia junto
 * con el texto que los explica. Partirlos en una tabla hija obligaría a versionarlos aparte y
 * abriría la puerta a un texto de la v2 con tramos de la v1.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${POLICIES} (
  _id              BIGSERIAL PRIMARY KEY,
  _tenant_id       BIGINT        NOT NULL,
  policy_code      VARCHAR(80)   NOT NULL,
  version_code     VARCHAR(40)   NOT NULL,
  language         VARCHAR(10)   NOT NULL DEFAULT 'es',
  title            VARCHAR(200)  NOT NULL,
  summary          TEXT          NOT NULL,
  body_md          TEXT          NOT NULL,
  source_kind      VARCHAR(20)   NOT NULL,
  source_reference VARCHAR(300),
  stages_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
  effective_from   DATE          NOT NULL,
  effective_until  DATE,
  status           VARCHAR(20)   NOT NULL DEFAULT 'active',
  _created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  _updated_at      TIMESTAMPTZ,
  _deleted         BOOLEAN       NOT NULL DEFAULT false
);`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${POLICIES}
  DROP CONSTRAINT IF EXISTS delinquency_policies_origen_conocido;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${POLICIES}
  ADD CONSTRAINT delinquency_policies_origen_conocido
  CHECK (source_kind IN ('regulatorio', 'atlas'));`);

  /*
   * Una regla presentada como regulatoria SIN decir de dónde sale es exactamente el problema que
   * `source_kind` vino a evitar: quien la lea la creerá ley y nadie podrá comprobarla. Se exige la
   * cita en la propia base, no en la revisión de código.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${POLICIES}
  DROP CONSTRAINT IF EXISTS delinquency_policies_regulatorio_citado;`);
  await queryInterface.sequelize.query(`
ALTER TABLE ${POLICIES}
  ADD CONSTRAINT delinquency_policies_regulatorio_citado
  CHECK (source_kind <> 'regulatorio' OR source_reference IS NOT NULL);`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_delinquency_policies_version
  ON ${POLICIES} (_tenant_id, policy_code, version_code, language)
  WHERE _deleted = false;`);

  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_delinquency_policies_vigentes
  ON ${POLICIES} (_tenant_id, policy_code, effective_from DESC)
  WHERE _deleted = false AND status = 'active';`);

  await seedFirstVersion(queryInterface);
}

/**
 * La primera versión.
 *
 * Va en la migración y no en un sembrador por lo mismo que el catálogo de permisos: los sembradores
 * corren una vez y `seed.js up` trunca antes de sembrar. Una política que la app necesita para
 * pintar una pantalla no puede depender de que alguien reejecute nada.
 */
async function seedFirstVersion(queryInterface: QueryInterface): Promise<void> {
  const stages = JSON.stringify([
    { code: 'al_dia', label: 'Al día', fromDay: null, toDay: 0, tone: 'ok', detail: 'No hay cuotas vencidas.' },
    {
      code: 'gracia',
      label: 'Período de gracia',
      fromDay: 1,
      toDay: 3,
      tone: 'info',
      detail: 'No se cobra interés penal. Se envía un recordatorio.',
    },
    {
      code: 'mora_temprana',
      label: 'Mora temprana',
      fromDay: 4,
      toDay: 29,
      tone: 'warn',
      detail: 'Corre interés penal sobre el capital vencido, contado desde el día 1 del atraso.',
    },
    {
      code: 'mora_media',
      label: 'Mora media',
      fromDay: 30,
      toDay: 89,
      tone: 'danger',
      detail: 'Se suspende la posibilidad de nuevas compras hasta regularizar.',
    },
    {
      code: 'mora_avanzada',
      label: 'Mora avanzada',
      fromDay: 90,
      toDay: 360,
      tone: 'danger',
      detail: 'El caso pasa a cobranza y se reporta a la Central de Información Crediticia.',
    },
    {
      code: 'categoria_f',
      label: 'Categoría F',
      fromDay: 361,
      toDay: null,
      tone: 'danger',
      detail: 'Clasificación de mayor riesgo según la normativa de calificación de cartera.',
    },
  ]);

  const body = [
    '## ¿Qué ocurre si te atrasas?',
    '',
    'El interés penal corre **únicamente sobre el capital de la cuota vencida**, nunca sobre el saldo total',
    'del crédito ni sobre los intereses ya devengados.',
    '',
    '**No capitalizamos intereses.** Los intereses vencidos no se suman al capital para volver a generar',
    'intereses. La normativa boliviana prohíbe la capitalización de intereses vencidos y el cobro de',
    'intereses extraordinarios o penalidades adicionales a las pactadas.',
    '',
    '**Todo lo que cobramos está publicado.** La Ley N° 393 de Servicios Financieros obliga a informar al',
    'público las tasas de interés efectivas, la tasa moratoria, las comisiones y cualquier otro cargo. Si un',
    'cargo no está en esta política, no se cobra.',
    '',
    '## ¿Cómo regularizo mi situación?',
    '',
    'Pagando la cuota vencida más el interés penal acumulado. Al quedar al día se levantan de inmediato las',
    'restricciones de compra.',
    '',
    '## Sobre tu historial',
    '',
    'A partir de los 90 días de atraso el caso se reporta a la Central de Información Crediticia. Antes de',
    'ese plazo, el atraso no genera reporte negativo.',
  ].join('\n');

  await queryInterface.sequelize.query(
    `
INSERT INTO ${POLICIES} (
  _tenant_id, policy_code, version_code, language, title, summary, body_md,
  source_kind, source_reference, stages_json, effective_from, status, _created_at
)
SELECT t._id, 'mora_e_intereses', 'v1', 'es',
       'Política de mora e intereses',
       'El interés penal corre sólo sobre el capital vencido, no se capitalizan intereses y todo cargo está publicado.',
       :body,
       'atlas',
       'Ley N° 393 de Servicios Financieros (21-ago-2013) y Recopilación de Normas para Servicios Financieros de ASFI. Los tramos por días de atraso son política comercial de Atlas: pendientes de contraste con el artículo exacto de la RNSF.',
       :stages::jsonb,
       DATE '2026-08-21', 'active', NOW()
FROM ${atlasSchemaFor('tenants')}.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ${POLICIES} p
  WHERE p._tenant_id = t._id AND p.policy_code = 'mora_e_intereses' AND p.version_code = 'v1' AND p._deleted = false
);`,
    { replacements: { body, stages } },
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${POLICIES};`);
}
