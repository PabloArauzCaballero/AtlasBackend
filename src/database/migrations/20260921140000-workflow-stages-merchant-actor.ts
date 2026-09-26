/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Esta pieza permite documentar los recorridos donde el COMERCIO es quien actúa.
 * @system amplía el vocabulario de actores de `workflow_stages` a los que la autenticación ya tiene.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('workflow_stages');
const STAGES = `${SCHEMA}.workflow_stages`;
const RESTRICCION = 'ck_workflow_stages_actor_type';

/**
 * Por qué hace falta.
 *
 * El catálogo de flujos admitía cuatro actores —`customer`, `internal_user`, `system`,
 * `external_provider`— y la autenticación de Atlas reconoce cuatro DISTINTOS:
 * `customer`, `internal_user`, `platform_user` y `merchant_user` (`actorTypeSchema` en
 * `auth.schemas.ts`). El comercio, que tiene su propio login (`POST /merchant/auth/login`), su
 * propio portal y 37 rutas a su nombre entre `partner-onboarding` y `merchant`, no podía aparecer
 * como actor de ninguna etapa.
 *
 * No era una limitación teórica: al documentar el recorrido que cruza al cliente con el comercio,
 * la siembra murió con `violates check constraint ck_workflow_stages_actor_type` en la etapa del
 * alta del partner. La alternativa —etiquetar al comercio como `internal_user`— habría sido peor
 * que el error: un recorrido que dice que el comercio es personal de Atlas documenta mal
 * exactamente lo que más importa de ese flujo, que son TRES autorizaciones distintas.
 *
 * Se añaden los dos que faltaban. `external_provider` se conserva porque el catálogo lo usa para
 * las etapas que ejecuta un tercero, y ése no es un actor autenticable.
 *
 * Es sólo una restricción: no toca una sola fila, así que se aplica sobre una base con datos sin
 * riesgo. El `down` la devuelve al conjunto anterior y por eso falla —con razón— si para entonces
 * existe una etapa de comercio: retirar el vocabulario sin retirar sus filas dejaría la tabla en un
 * estado que la propia restricción prohíbe.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  // `DROP ... IF EXISTS` antes de `ADD`: PostgreSQL no tiene `ADD CONSTRAINT IF NOT EXISTS`, y sin
  // esto la migración no se puede reaplicar tras un `down`→`up` ni tras un fallo a la mitad.
  await queryInterface.sequelize.query(`ALTER TABLE ${STAGES} DROP CONSTRAINT IF EXISTS ${RESTRICCION};`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${STAGES}
       ADD CONSTRAINT ${RESTRICCION}
       CHECK (actor_type IN ('customer', 'internal_user', 'merchant_user', 'platform_user', 'system', 'external_provider'));`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${STAGES} DROP CONSTRAINT IF EXISTS ${RESTRICCION};`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${STAGES}
       ADD CONSTRAINT ${RESTRICCION}
       CHECK (actor_type IN ('customer', 'internal_user', 'system', 'external_provider'));`,
  );
}
