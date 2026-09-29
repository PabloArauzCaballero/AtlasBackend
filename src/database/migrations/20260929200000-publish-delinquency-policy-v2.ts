/**
 * @file Migración reversible: publica la versión v2 de la política de mora y deja la v1 como histórica.
 * @business La política publicada al cliente tiene que decir lo que el sistema hace: la v1 prometía
 *   avisos, interés penal, bloqueo de compras y reporte a una central de riesgo que no existen.
 * @system inserta la v2 de `mora_e_intereses` por tenant y marca la v1 `superseded` con fecha de fin,
 *   sin tocar su texto; `down` borra la v2 y devuelve la v1 a `active`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const POLICIES = `${atlasSchemaFor('delinquency_policies')}.delinquency_policies`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

const POLICY_CODE = 'mora_e_intereses';
const PREVIOUS_VERSION = 'v1';
const VERSION = 'v2';

/**
 * Por qué una versión nueva y no un `UPDATE` del texto.
 *
 * La v1 ya pudo mostrarse a clientes, y la tabla existe justo para poder decir qué texto regía en
 * cada fecha. Reescribirla borraría esa respuesta. Así que la v1 se conserva palabra por palabra:
 * sólo se le pone fecha de fin (`effective_until`) y estado `superseded`, y la v2 entra el día en
 * que se aplica esta migración en cada entorno —no una fecha fija—, porque es el día en que de
 * verdad empieza a enseñarse.
 *
 * La fecha se toma en UTC porque `DelinquencyPolicyService.current` compara con
 * `new Date().toISOString()`, también en UTC. Con fechas en husos distintos, el día del despliegue
 * podría no haber ninguna versión vigente.
 *
 * ## Qué dice la v2, y de dónde sale cada frase
 *
 * - Días de atraso desde la cuota impaga más antigua: `loanDaysPastDue` en
 *   `modules/loans/domain/loan-delinquency.ts`, recalculado por el job `sweep_loan_delinquency`.
 * - Tramos 1–29, 30–59, 60–89 y 90+: `bucketForDaysPastDue` (mismo archivo).
 * - Sin cargo por atraso: `late_fee_amount` nace en '0.00' (`loan-disbursement-terms.ts`) y ningún
 *   código lo vuelve a escribir.
 * - Límite recalculado al cambiar de tramo: `LoanDelinquencyService.refreshCreditLines`
 *   (disparador `delinquency` o `repayment`); puede bajar porque lo decide el Motor.
 * - Qué resta en el historial de pago: `paymentHistoryScore` en `credit/domain/relationship-score.ts`
 *   (peor atraso desde 1, 30 y 90 días; cuotas vencidas del último año; préstamos castigados) y
 *   `PaymentCapacityService` (cuotas pagadas con atraso).
 * - Categoría de riesgo por días de atraso: el barrido `sweep_debt_ratings` (módulo `credit-rating`).
 * - Castigo: `LoanWriteOffService`, sólo `admin`/`platform_admin`, con motivo obligatorio.
 *
 * Lo que la v1 afirmaba y el sistema no hace —avisos automáticos, interés penal, bloqueo de nuevas
 * compras, reporte a una central de riesgo— no aparece. La prueba
 * `test/integration/loans/delinquency-policy-published.spec.ts` lo vigila contra la lista de
 * `modules/loans/domain/delinquency-policy-claims.ts`.
 */
const STAGES = [
  {
    code: 'al_dia',
    label: 'Al día',
    fromDay: null,
    toDay: 0,
    tone: 'ok',
    detail: 'No tienes cuotas vencidas sin pagar.',
  },
  {
    code: 'atraso_1_29',
    label: 'Atraso de 1 a 29 días',
    fromDay: 1,
    toDay: 29,
    tone: 'warn',
    detail:
      'Tu préstamo figura en mora. El atraso queda en tu historial de pago con Atlas y volvemos a calcular tu límite de crédito, que puede bajar.',
  },
  {
    code: 'atraso_30_59',
    label: 'Atraso de 30 a 59 días',
    fromDay: 30,
    toDay: 59,
    tone: 'danger',
    detail: 'El atraso resta más en tu historial de pago que uno menor de 30 días. Volvemos a calcular tu límite de crédito.',
  },
  {
    code: 'atraso_60_89',
    label: 'Atraso de 60 a 89 días',
    fromDay: 60,
    toDay: 89,
    tone: 'danger',
    detail: 'Volvemos a calcular tu límite de crédito.',
  },
  {
    code: 'atraso_90',
    label: 'Atraso de 90 días o más',
    fromDay: 90,
    toDay: null,
    tone: 'danger',
    detail: 'Es el atraso que más resta en tu historial de pago con Atlas. Volvemos a calcular tu límite de crédito.',
  },
];

const BODY = [
  '## ¿Cuándo estás en mora?',
  '',
  'Desde el día siguiente al vencimiento de una cuota que no pagaste completa. Los días de atraso se',
  'cuentan desde la cuota impaga más antigua. El sistema los revisa automáticamente y los guarda en',
  'tu préstamo.',
  '',
  '## ¿Qué te cobramos por atrasarte?',
  '',
  'Esta versión de la política no aplica ningún cargo por atraso: ni intereses adicionales ni',
  'comisiones. Lo que debes es lo que dice el cronograma de tu préstamo. No capitalizamos intereses.',
  'Si un cargo no está en esta política, no se cobra.',
  '',
  '## ¿Cómo afecta a tu crédito con Atlas?',
  '',
  'Cada vez que tu préstamo cambia de tramo de atraso volvemos a calcular tu límite de crédito, que',
  'puede bajar. Tu historial de pago con Atlas es uno de los datos de ese cálculo, y en él restan las',
  'cuotas pagadas con atraso, las cuotas vencidas sin pagar del último año, el peor atraso que hayas',
  'tenido —más cuanto más largo fue— y cualquier préstamo castigado.',
  '',
  'Además, cada crédito recibe una categoría de riesgo según sus días de atraso.',
  '',
  '## ¿Cómo te pones al día?',
  '',
  'Pagando las cuotas vencidas. En la siguiente revisión automática tu préstamo vuelve a figurar al día',
  'y volvemos a calcular tu límite. El peor atraso que tuviste sigue constando en tu historial de pago',
  'con Atlas.',
  '',
  '## ¿Qué es castigar un préstamo?',
  '',
  'Una persona administradora de Atlas puede castigar un préstamo impago: lo registra como pérdida,',
  'con un motivo escrito. Es lo que más resta en tu historial de pago con Atlas.',
].join('\n');

const TITLE = 'Política de mora e intereses';
const SUMMARY =
  'Si te atrasas, tu préstamo figura en mora por días de atraso y volvemos a calcular tu límite de crédito. Esta versión no cobra cargos por atraso.';
const SOURCE_REFERENCE = 'Política propia de Atlas. Describe lo que el sistema aplica hoy y sustituye a la versión v1 del 21-ago-2026.';

/** Los textos de la v2 tal y como se publican. Exportados para que las pruebas lean ESTOS, no una copia. */
export const DELINQUENCY_POLICY_V2 = {
  policyCode: POLICY_CODE,
  versionCode: VERSION,
  title: TITLE,
  summary: SUMMARY,
  bodyMarkdown: BODY,
  source: { kind: 'atlas', reference: SOURCE_REFERENCE },
  stages: STAGES,
} as const;

/** Hoy en UTC, el mismo reloj con el que `DelinquencyPolicyService` decide qué versión rige. */
const TODAY_UTC = `(NOW() AT TIME ZONE 'UTC')::date`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    /*
     * Una fila por tenant, también para los que no llegaron a tener la v1. `NOT EXISTS` hace la
     * migración repetible: reaplicarla no duplica la v2 ni le mueve la fecha de entrada.
     */
    await queryInterface.sequelize.query(
      `
INSERT INTO ${POLICIES} (
  _tenant_id, policy_code, version_code, language, title, summary, body_md,
  source_kind, source_reference, stages_json, effective_from, status, _created_at
)
SELECT t._id, :policyCode, :version, 'es', :title, :summary, :body,
       'atlas', :sourceReference, :stages::jsonb, ${TODAY_UTC}, 'active', NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${POLICIES} p
  WHERE p._tenant_id = t._id AND p.policy_code = :policyCode AND p.version_code = :version
    AND p.language = 'es' AND p._deleted = false
);`,
      {
        transaction,
        replacements: {
          policyCode: POLICY_CODE,
          version: VERSION,
          title: TITLE,
          summary: SUMMARY,
          body: BODY,
          sourceReference: SOURCE_REFERENCE,
          stages: JSON.stringify(STAGES),
        },
      },
    );

    /*
     * La v1 termina el día anterior a la entrada de la v2 de SU tenant, y su texto no se toca. Sólo
     * se cierra la que sigue abierta (`effective_until IS NULL`): repetir la migración no mueve la
     * fecha de fin que ya se escribió.
     */
    await queryInterface.sequelize.query(
      `
UPDATE ${POLICIES} p
SET status = 'superseded',
    effective_until = GREATEST(p.effective_from, v2.effective_from - 1),
    _updated_at = NOW()
FROM ${POLICIES} v2
WHERE p.policy_code = :policyCode AND p.version_code = :previous AND p._deleted = false
  AND p.status = 'active' AND p.effective_until IS NULL
  AND v2._tenant_id = p._tenant_id AND v2.policy_code = :policyCode AND v2.version_code = :version
  AND v2.language = p.language AND v2._deleted = false;`,
      { transaction, replacements: { policyCode: POLICY_CODE, previous: PREVIOUS_VERSION, version: VERSION } },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Vuelve al estado anterior: la v1 vigente y sin fecha de fin, y la v2 fuera.
 *
 * La v2 se borra de verdad y no con `_deleted`: el índice único de versión ignora las borradas, y
 * una fila borrada lógicamente dejaría a la siguiente `up` insertar otra v2 junto a ella.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.sequelize.query(
      `
UPDATE ${POLICIES}
SET status = 'active', effective_until = NULL, _updated_at = NOW()
WHERE policy_code = :policyCode AND version_code = :previous AND status = 'superseded' AND _deleted = false;`,
      { transaction, replacements: { policyCode: POLICY_CODE, previous: PREVIOUS_VERSION } },
    );
    await queryInterface.sequelize.query(`DELETE FROM ${POLICIES} WHERE policy_code = :policyCode AND version_code = :version;`, {
      transaction,
      replacements: { policyCode: POLICY_CODE, version: VERSION },
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
