/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza mantiene la promesa de privacidad del dispositivo sin bloquear la agenda que el cliente sí autorizó.
 * @system reemplaza el CHECK de `on_device_computation_runs` por uno que distingue los tres caminos.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const RUNS = `${atlasSchemaFor('on_device_computation_runs')}.on_device_computation_runs`;
const VIEJO = 'ck_on_device_no_raw_contacts_or_sms';
const NUEVO = 'ck_on_device_raw_storage_por_algoritmo';

/**
 * Un endpoint devolvía 500 porque el esquema prohibía lo que el producto ya autoriza.
 *
 * `POST /customers/:id/address-book` viola `ck_on_device_no_raw_contacts_or_sms` al insertar en
 * `on_device_computation_runs`. Detectado el 2026-09-08 en el servidor y confirmado contra el
 * tráfico real: es un 500 en producción, no un caso de laboratorio.
 *
 * La causa es una migración a medias. El CHECK viene del esquema inicial (junio), cuando el ÚNICO
 * cálculo en dispositivo era el resumen agregado: nueve números y ninguna ficha, y por eso
 * `raw_contacts_stored` valía `false` siempre y la restricción lo dejaba escrito. En septiembre
 * `20260904120000-create-device-contacts-and-location-pings` añadió la sincronización COMPLETA de
 * la agenda —con su propia tabla, su propio consentimiento y su propia pantalla de permiso— y su
 * comentario lo dice con todas las letras: «a partir de aquí esa columna puede valer `true`». Lo
 * que no hizo fue tocar el CHECK, así que el esquema siguió prohibiendo exactamente lo que la
 * función nueva escribe.
 *
 * ## Qué se conserva, y qué no
 *
 * NO se afloja la garantía, se le pone el alcance correcto. Lo que sigue siendo absoluto:
 *
 *  - **Los SMS no se guardan nunca.** Ningún camino los escribe y ninguno debe poder hacerlo. Esa
 *    mitad del CHECK original se mantiene tal cual, para los tres algoritmos.
 *  - **El resumen agregado sigue sin poder guardar fichas.** `CONTACTS_ADDRESS_BOOK_SNAPSHOT` y
 *    `atlas_on_device_metrics` sólo publican cuentas y proporciones; si algún día uno de ellos
 *    intentara escribir `raw_contacts_stored = true`, la base lo seguiría rechazando.
 *
 * Lo que se permite, y sólo ahí: `CONTACTS_ADDRESS_BOOK_SYNC`, que es el camino que el cliente
 * autoriza expresamente y cuyas fichas viven en `customer_device_contacts` atadas a un
 * consentimiento. Para ese algoritmo la columna deja de ser una constante y pasa a ser el hecho que
 * distingue una captura de otra — que es justo para lo que se escribió.
 *
 * Un `algorithm_code` nulo o desconocido cae del lado restrictivo: si no consta qué se ejecutó, no
 * consta que hubiera permiso para guardar nada.
 *
 * ## Por qué `IS NOT DISTINCT FROM` y no `=`
 *
 * Porque con `=` la garantía tiene un agujero, y no es teórico: se midió. Un CHECK de PostgreSQL
 * acepta la fila cuando la expresión da TRUE **o NULL**, y con `algorithm_code` nulo,
 * `algorithm_code = 'CONTACTS_ADDRESS_BOOK_SYNC'` no da FALSE sino NULL — que se propaga por el
 * `AND` y por el `OR` hasta dejar todo el CHECK en NULL. Resultado: una fila con
 * `raw_contacts_stored = true` y sin algoritmo declarado ENTRABA, que es exactamente el caso que
 * esta restricción existe para impedir.
 *
 * `IS NOT DISTINCT FROM` compara tratando el nulo como un valor más y devuelve FALSE, nunca NULL.
 * Comprobado contra un PostgreSQL real, no deducido: con `=` la fila sin algoritmo se aceptaba.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE ${RUNS} DROP CONSTRAINT IF EXISTS ${VIEJO};
  `);
  await queryInterface.sequelize.query(`
    ALTER TABLE ${RUNS} DROP CONSTRAINT IF EXISTS ${NUEVO};
  `);
  await queryInterface.sequelize.query(`
    ALTER TABLE ${RUNS} ADD CONSTRAINT ${NUEVO} CHECK (
      raw_sms_stored IS FALSE
      AND (
        raw_contacts_stored IS FALSE
        OR (raw_contacts_stored IS TRUE AND algorithm_code IS NOT DISTINCT FROM 'CONTACTS_ADDRESS_BOOK_SYNC')
      )
    );
  `);
}

/**
 * Volver atrás restaura el CHECK original, y por eso puede fallar: si mientras tanto se sincronizó
 * alguna agenda, esas filas ya no lo cumplen. Es lo correcto —revertir esta migración es decir «el
 * producto ya no guarda fichas», y entonces esas filas son el problema, no el CHECK— y falla
 * ruidosamente en vez de dejar el esquema mintiendo.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE ${RUNS} DROP CONSTRAINT IF EXISTS ${NUEVO};
  `);
  await queryInterface.sequelize.query(`
    ALTER TABLE ${RUNS} ADD CONSTRAINT ${VIEJO} CHECK (raw_contacts_stored IS FALSE AND raw_sms_stored IS FALSE);
  `);
}
