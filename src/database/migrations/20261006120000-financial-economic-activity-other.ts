/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Quien elige «Otra actividad» como rubro tiene que poder decir CUÁL; si no, el dato queda vacío y nadie sabe a qué se dedica.
 * @system da de alta en `attribute_definitions` el atributo `economic_activity_other` (texto libre, fuera de la decisión de crédito).
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Mismo patrón que `20260928121000-financial-income-band-and-frequency`: COPIA la fila de
 * `economic_activity_code` (el rubro, dato de la misma naturaleza) y cambia código y nombre. A diferencia
 * del rubro, el texto libre NO es candidato a modelo ni se permite en la decisión de crédito: un texto
 * escrito a mano no es una variable comparable entre clientes. Si la base no tiene la fila de origen
 * (catálogo sin sembrar), no inserta nada y el endpoint responde `ATTRIBUTE_CATALOG_NOT_SEEDED`, como el
 * resto del perfil.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `CREATE TEMP TABLE tmp_attribute_definition AS
       SELECT * FROM attribute_definitions WHERE attribute_code = 'economic_activity_code' ORDER BY _id LIMIT 1;
     UPDATE tmp_attribute_definition
        SET _id = (SELECT COALESCE(MAX(_id), 0) + 1 FROM attribute_definitions),
            attribute_code = 'economic_activity_other',
            attribute_name = 'Actividad económica declarada (texto libre de «Otra actividad»)',
            is_model_candidate = false,
            allowed_for_credit_decision = false,
            _created_at = NOW(),
            _updated_at = NOW();
     INSERT INTO attribute_definitions
       SELECT * FROM tmp_attribute_definition
        WHERE NOT EXISTS (SELECT 1 FROM attribute_definitions WHERE attribute_code = 'economic_activity_other');
     DROP TABLE tmp_attribute_definition;`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM attribute_definitions
      WHERE attribute_code = 'economic_activity_other'
        AND NOT EXISTS (
          SELECT 1 FROM customer_attribute_values v
           WHERE v.attribute_definition_id = attribute_definitions._id
        );`,
  );
}
