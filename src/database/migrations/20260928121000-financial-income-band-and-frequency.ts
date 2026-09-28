/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El alta pide el ingreso por banda y su frecuencia (mensual, quincenal, semanal, irregular) para alinear los pagos con el día de cobro.
 * @system da de alta en `attribute_definitions` los atributos `monthly_income_band` e `income_frequency`.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Los atributos del perfil económico se validan contra el catálogo (`ATTRIBUTE_CATALOG_NOT_SEEDED` si
 * falta la fila), y el catálogo de las bases desplegadas no se vuelve a sembrar en cada despliegue. Por
 * eso los dos atributos nuevos entran por migración.
 *
 * Cada fila COPIA la de `employment_status` —otro dato categórico declarado por el cliente en el alta—
 * y cambia sólo código y nombre: así hereda la clasificación, el consentimiento y la revisión legal
 * que ya tiene un dato de la misma naturaleza, sin escribir aquí columnas que otra migración puede
 * haber cambiado. Si la base no tiene esa fila (catálogo sin sembrar), no inserta nada: el endpoint ya
 * falla con `ATTRIBUTE_CATALOG_NOT_SEEDED` en ese caso, igual que para el resto del perfil.
 *
 * `_id` explícito (máximo + 1): la siembra escribe ids explícitos y la secuencia puede ir por detrás.
 */
const ATTRIBUTES: Array<{ code: string; name: string }> = [
  { code: 'monthly_income_band', name: 'Rango de ingreso mensual declarado' },
  { code: 'income_frequency', name: 'Frecuencia de ingreso declarada' },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const attribute of ATTRIBUTES) {
    await queryInterface.sequelize.query(
      `CREATE TEMP TABLE tmp_attribute_definition AS
         SELECT * FROM attribute_definitions WHERE attribute_code = 'employment_status' ORDER BY _id LIMIT 1;
       UPDATE tmp_attribute_definition
          SET _id = (SELECT COALESCE(MAX(_id), 0) + 1 FROM attribute_definitions),
              attribute_code = :code,
              attribute_name = :name,
              _created_at = NOW(),
              _updated_at = NOW();
       INSERT INTO attribute_definitions
         SELECT * FROM tmp_attribute_definition
          WHERE NOT EXISTS (SELECT 1 FROM attribute_definitions WHERE attribute_code = :code);
       DROP TABLE tmp_attribute_definition;`,
      { replacements: attribute },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM attribute_definitions
      WHERE attribute_code IN ('monthly_income_band', 'income_frequency')
        AND NOT EXISTS (
          SELECT 1 FROM customer_attribute_values v
           WHERE v.attribute_definition_id = attribute_definitions._id
        );`,
  );
}
