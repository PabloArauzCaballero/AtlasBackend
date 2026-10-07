/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Cada caja necesita un código corto que se pueda teclear cuando la cámara no lee su QR.
 * @system agrega `partner_pos_terminals.manual_code`, lo rellena en las cajas existentes y lo hace único por tenant.
 */
import { DataTypes, QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLA = { tableName: 'partner_pos_terminals', schema: atlasSchemaFor('partner_pos_terminals') };
const TABLA_SQL = `${atlasSchemaFor('partner_pos_terminals')}.partner_pos_terminals`;
const INDICE = 'partner_pos_terminals_manual_code_key';

/**
 * Nulable en la base y obligatorio en el código: las cajas que ya existen se rellenan aquí mismo, y
 * las nuevas lo reciben al registrarse. No se fuerza NOT NULL para que un `INSERT` ajeno (una
 * siembra, una importación) no tumbe la API — en ese caso la caja simplemente no se puede teclear
 * hasta que se le asigne uno.
 *
 * El alfabeto es el de `pos-manual-code.ts` (sin 0/O, 1/I/L, U/V). El índice deja fuera a las
 * retiradas por la misma razón que el del serial: un equipo reacondicionado vuelve a nacer.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const columnas = await queryInterface.describeTable(TABLA);
  if (!columnas['manual_code']) await queryInterface.addColumn(TABLA, 'manual_code', { type: DataTypes.STRING(12), allowNull: true });

  await queryInterface.sequelize.query(`
DO $$
DECLARE
  fila RECORD;
  alfabeto CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTWXYZ';
  candidato TEXT;
BEGIN
  FOR fila IN SELECT _id, _tenant_id FROM ${TABLA_SQL} WHERE manual_code IS NULL LOOP
    LOOP
      candidato := '';
      FOR i IN 1..8 LOOP
        candidato := candidato || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM ${TABLA_SQL} WHERE _tenant_id = fila._tenant_id AND manual_code = candidato AND status <> 'retired'
      );
    END LOOP;
    UPDATE ${TABLA_SQL} SET manual_code = candidato WHERE _id = fila._id;
  END LOOP;
END $$;`);

  await queryInterface.sequelize.query(`
CREATE UNIQUE INDEX IF NOT EXISTS ${INDICE}
  ON ${TABLA_SQL} (_tenant_id, manual_code) WHERE status <> 'retired' AND manual_code IS NOT NULL;`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${atlasSchemaFor('partner_pos_terminals')}.${INDICE};`);
  await queryInterface.removeColumn(TABLA, 'manual_code');
}
