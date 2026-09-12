/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Sin matriz vigente no hay previsión: la cartera no se puede calificar ni provisionar.
 * @system siembra la política de calificación GLOBAL, idempotente, con la misma escala de seis
 *   categorías que el código ya declara. Sin ella, todo el motor de calificación responde
 *   `RATING_POLICY_NOT_ACTIVE` en cualquier instalación nueva.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const POLICY_VERSIONS = `${atlasSchemaFor('rating_policy_versions')}.rating_policy_versions`;
const POLICY_BANDS = `${atlasSchemaFor('rating_policy_bands')}.rating_policy_bands`;

/*
 * Los MISMOS códigos que ya tiene la instalación de pruebas, no unos nuevos.
 *
 * La fila existe allí desde antes (la creó la base publicadora), y sembrar aquí con otro código
 * habría dejado dos políticas activas: una global con este código y otra global con el suyo. El
 * índice único no lo impide —son códigos distintos— y `findActivePolicy` devolvería la que
 * ordenara la consulta, que es exactamente la avería que el índice existe para evitar: la cartera
 * calificada con dos matrices y ninguna columna que diga cuál usó cada fila.
 */
const POLICY_CODE = 'asfi_portfolio_rating';
const VERSION_CODE = 'v1';
const SCALE_CODE = 'asfi_a_f';

/**
 * La escala, y de dónde sale cada número.
 *
 * **No se decide aquí.** Es exactamente la que el código ya declara en dos sitios independientes
 * —`test/unit/credit-rating/rating-scale.spec.ts` y `test/unit/credit-rating-scale-catalog.spec.ts`—
 * y la misma que tiene cargada la instalación de pruebas. Lo que faltaba no era elegir una escala:
 * era que una instalación LIMPIA tuviera la que el código ya da por supuesta. Sin esta fila,
 * `resolveActivePolicy` lanza `RATING_POLICY_NOT_ACTIVE` y con él caen el barrido nocturno, la
 * previsión y el reparto de cartera por categoría — y el fallo aparece como un 422 en una pantalla,
 * no como «falta sembrar».
 *
 * `severity_rank` 0 es la mejor: el arrastre al cliente usa ese orden, nunca las letras.
 */
const BANDS = [
  { grade: 'A', label: 'Normal', rank: 0, min: 0, max: 0, provision: 0.01 },
  { grade: 'B', label: 'Riesgo potencial', rank: 1, min: 1, max: 30, provision: 0.05 },
  { grade: 'C', label: 'Deficiente', rank: 2, min: 31, max: 60, provision: 0.2 },
  { grade: 'D', label: 'Dudoso', rank: 3, min: 61, max: 90, provision: 0.5 },
  { grade: 'E', label: 'Pérdida', rank: 4, min: 91, max: 180, provision: 0.8 },
  { grade: 'F', label: 'Pérdida irrecuperable', rank: 5, min: 181, max: null, provision: 1 },
] as const;

/**
 * La procedencia va EN LA FILA, no sólo en este comentario.
 *
 * El código de la política se llama `asfi_portfolio_rating` porque la escala A–F es la boliviana,
 * pero los porcentajes de previsión NO están contrastados contra el artículo exacto de la RNSF, y
 * tienen consecuencia contable. Afirmar la cita sería escribir en la base un hecho regulatorio que
 * nadie verificó — el mismo cuidado que ya se tomó en la política de mora, que dice literalmente
 * «pendientes de contraste con el artículo exacto de la RNSF».
 */
const DESCRIPTION = [
  'Escala de seis categorías por días de atraso, con la tasa de previsión de cada una.',
  '',
  'PROCEDENCIA: son los parámetros que el código de Atlas ya declaraba (rating-scale.spec.ts y',
  'credit-rating-scale-catalog.spec.ts). El nombre cita a ASFI porque la escala A-F es la boliviana,',
  'pero los PORCENTAJES no están contrastados contra el artículo exacto de la Recopilación de Normas',
  'para Servicios Financieros: figuran como parámetro propio hasta que Riesgos apruebe la versión',
  'definitiva, y por eso no se afirma la cita aquí.',
  '',
  'Los tramos son coherentes con la política de mora publicada al cliente (mora temprana desde el',
  'día 4, media desde 30, avanzada desde 90) y con `delinquency_bucket`, que corta en 30, 60 y 90.',
  '',
  'Para cambiarla NO se editan estas filas: se crea una versión nueva y se activa. Cada calificación',
  'guarda su `policy_version_id`, que es lo que permite reproducirla con la matriz que regía.',
].join('\n');

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * GLOBAL (`_tenant_id` nulo) y no una por tenant, por dos razones medidas:
   *
   * 1. Es como resuelve `CreditRatingRepository.findActivePolicy`: busca la del tenant y, si no
   *    hay, cae a la global. Una global sirve a todos, que es lo que quiere una plataforma con la
   *    misma matriz para toda la cartera; un tenant que apruebe la suya la añade y gana por
   *    precedencia, sin tocar esta fila.
   * 2. Una siembra por tenant NO SEMBRARÍA NADA en una instalación limpia: las migraciones corren
   *    antes de que exista el primer tenant, así que `FROM tenants` no devuelve filas y la política
   *    nunca llegaría. El defecto sería invisible hasta el primer barrido.
   *
   * `NOT EXISTS` sobre cualquier activa GLOBAL, no sobre la clave (código, versión): si una
   * instalación ya tiene su matriz activa —con umbrales que aprobó su comité— esta migración no
   * añade una segunda. Sembrar lo que falta, nunca pisar lo que alguien decidió.
   */
  await queryInterface.sequelize.query(
    `
INSERT INTO ${POLICY_VERSIONS} (
  _tenant_id, policy_code, version_code, scale_code, status,
  effective_from, contamination_enabled, description, _created_at
)
SELECT NULL, :policyCode, :versionCode, :scaleCode, 'active',
       NOW(), true, :description, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM ${POLICY_VERSIONS} p
  WHERE p._tenant_id IS NULL AND p.status = 'active'
);`,
    {
      replacements: {
        policyCode: POLICY_CODE,
        versionCode: VERSION_CODE,
        scaleCode: SCALE_CODE,
        description: DESCRIPTION,
      },
    },
  );

  /*
   * Las bandas se cuelgan sólo de la versión que ESTA migración siembra, identificada por su código
   * Y su versión. Mezclarlas con las de otra política fabricaría una escala con huecos o solapes: no
   * fallaría al insertar, y `normalizeScale` la rechazaría en el barrido nocturno, lejos de aquí.
   */
  for (const band of BANDS) {
    await queryInterface.sequelize.query(
      `
INSERT INTO ${POLICY_BANDS} (
  policy_version_id, grade, grade_label, severity_rank,
  min_days_past_due, max_days_past_due, provision_rate, _created_at
)
SELECT p._id, :grade, :label, :rank, :minDays, :maxDays, :provision, NOW()
FROM ${POLICY_VERSIONS} p
WHERE p.policy_code = :policyCode
  AND p.version_code = :versionCode
  AND p._tenant_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ${POLICY_BANDS} b
    WHERE b.policy_version_id = p._id AND b.grade = :grade
  );`,
      {
        replacements: {
          grade: band.grade,
          label: band.label,
          rank: band.rank,
          minDays: band.min,
          maxDays: band.max,
          provision: band.provision,
          policyCode: POLICY_CODE,
          versionCode: VERSION_CODE,
        },
      },
    );
  }
}

/**
 * Se retira lo que esta migración sembró, y nada más.
 *
 * Acotado por código Y versión: revertir una siembra no puede borrar la matriz que un comité activó
 * después. Y no se borra si ya hay calificaciones colgando de ella —la FK lo impediría—, que es el
 * comportamiento correcto: una previsión emitida tiene que seguir siendo reproducible.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `
DELETE FROM ${POLICY_BANDS}
WHERE policy_version_id IN (
  SELECT _id FROM ${POLICY_VERSIONS}
  WHERE policy_code = :policyCode AND version_code = :versionCode AND _tenant_id IS NULL
);`,
    { replacements: { policyCode: POLICY_CODE, versionCode: VERSION_CODE } },
  );
  await queryInterface.sequelize.query(
    `
DELETE FROM ${POLICY_VERSIONS}
WHERE policy_code = :policyCode AND version_code = :versionCode AND _tenant_id IS NULL;`,
    { replacements: { policyCode: POLICY_CODE, versionCode: VERSION_CODE } },
  );
}
