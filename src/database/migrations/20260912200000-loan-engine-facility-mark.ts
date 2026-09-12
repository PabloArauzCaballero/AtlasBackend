/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Deja ver qué créditos concedidos el motor todavía no puede medir.
 * @system añade la marca del alta del crédito en el motor, para que la pasada de registro sea
 *   incremental en vez de reenviar la cartera entera en cada barrido.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const LOANS = `${atlasSchemaFor('loans')}.loans`;

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Una MARCA y no una tabla de estado: la pregunta que hay que poder contestar es «¿qué créditos
   * no están todavía en el motor?», y eso es una columna nula.
   *
   * Sin ella la pasada de registro tendría dos salidas malas: reenviar la cartera completa en cada
   * barrido —idempotente pero caro, y creciendo para siempre—, o registrar sólo los créditos que ya
   * tienen desenlaces pendientes, que deja fuera precisamente a los recién desembolsados, que son la
   * población que una cosecha joven necesita para existir.
   */
  await queryInterface.sequelize.query(`
ALTER TABLE ${LOANS}
  ADD COLUMN IF NOT EXISTS decision_facility_registered_at TIMESTAMPTZ;
`);

  /*
   * Índice PARCIAL sobre lo que falta, no sobre toda la columna.
   *
   * La consulta del barrido es «dame los que aún no están registrados», así que el índice sólo
   * necesita contener esas filas. Sobre una cartera sana el índice queda casi vacío —es la forma
   * correcta de indexar una cola de trabajo— y no crece con la cartera ya registrada.
   */
  await queryInterface.sequelize.query(`
CREATE INDEX IF NOT EXISTS ix_loans_pending_facility_registration
  ON ${LOANS} (disbursed_at)
  WHERE decision_facility_registered_at IS NULL AND decision_execution_id IS NOT NULL;
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ix_loans_pending_facility_registration;`);
  await queryInterface.sequelize.query(`ALTER TABLE ${LOANS} DROP COLUMN IF EXISTS decision_facility_registered_at;`);
}
