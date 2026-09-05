/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Permite elegir desde el portal qué política decide cada cosa, sin tocar un servidor.
 * @system crea `catalog.decision_artifact_bindings`, la asignación tipo de decisión → artefacto.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('decision_artifact_bindings');
const TABLE = `${SCHEMA}.decision_artifact_bindings`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const INTERNAL_USERS = `${atlasSchemaFor('internal_users')}.internal_users`;

/**
 * Qué artefacto decide cada cosa era una VARIABLE DE ENTORNO.
 *
 * `DECISION_ENGINE_IDENTITY_ARTIFACT` y `DECISION_ENGINE_CREDIT_ARTIFACT` vivían en el `.env` y en
 * el `docker-compose.yml`. Eso tiene tres consecuencias, y las tres se pagaron ya:
 *
 * 1. **Cambiar qué política decide un crédito exigía un despliegue.** No es una decisión de
 *    infraestructura: es de negocio, y la toma Riesgo, no quien tiene acceso al servidor.
 * 2. **Nadie podía VER qué artefacto estaba decidiendo.** Si Riesgo publica una versión nueva en el
 *    motor, el backend sigue llamando a lo que diga su entorno, y no había pantalla que lo dijera.
 * 3. **Se podía apuntar a un artefacto que no existe.** El valor por defecto era
 *    `credit_underwriting`, que en el motor se llama `ATLAS_BNPL_UNDERWRITING`: toda solicitud de
 *    crédito daba 404 y caía en «el motor no está disponible» — un fallo silencioso que dejaba cada
 *    crédito esperando a una persona sin que nada dijera que el motor ni siquiera fue consultado.
 *
 * Con la asignación en base y elegida de una lista que el propio motor publica, el punto 3 deja de
 * ser posible: no se puede elegir un código que no existe.
 *
 * ## Por qué una tabla y no una columna en `tenants`
 *
 * Porque los tipos de decisión crecen —identidad, crédito, riesgo, cobranzas, y los que vengan— y
 * cada uno necesita su historia: quién lo cambió, cuándo y por qué. Una fila por asignación da eso
 * gratis; una columna por tipo obliga a una migración cada vez que aparece una decisión nueva.
 *
 * ## El entorno sigue siendo el respaldo
 *
 * Si no hay fila para un tipo, se usa la variable de entorno como hasta ahora. Así esto se puede
 * desplegar sin configurar nada y sin romper a quien ya funciona; la fila sólo aparece cuando
 * alguien elige de verdad.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
CREATE TABLE IF NOT EXISTS ${TABLE} (
  _id                BIGSERIAL PRIMARY KEY,
  _tenant_id         BIGINT NOT NULL REFERENCES ${TENANTS}(_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  decision_type      VARCHAR(40)  NOT NULL,
  artifact_code      VARCHAR(120) NOT NULL,
  environment_code   VARCHAR(40),
  notes              VARCHAR(500),
  changed_by_internal_user_id BIGINT REFERENCES ${INTERNAL_USERS}(_id) ON UPDATE CASCADE ON DELETE SET NULL,
  _created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  _updated_at        TIMESTAMPTZ,
  CONSTRAINT uq_decision_artifact_binding UNIQUE (_tenant_id, decision_type)
);`);

  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_decision_artifact_bindings__tenant_id ON ${TABLE} (_tenant_id);`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${TABLE};`);
}
