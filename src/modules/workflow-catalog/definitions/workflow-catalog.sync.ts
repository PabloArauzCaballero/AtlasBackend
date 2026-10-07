/**
 * @file Volcado idempotente: escribe en la base los procesos declarados en código.
 * @business Esta pieza hace que una base recién migrada —producción incluida— tenga el catálogo de procesos sin depender de la siembra demo, que es opt-in.
 * @system `syncWorkflowCatalog` hace upsert por clave natural de definiciones, etapas, pasos y dependencias, retira lo que la fixture ya no declara y deja la huella en `workflow_definitions_sync`.
 */
import { createHash } from 'node:crypto';
import type { QueryInterface, Transaction } from 'sequelize';
import {
  DEFINITION_UPSERT_SQL,
  DEPENDENCIES,
  STAGES,
  STAGE_UPSERT_SQL,
  STEPS,
  STEP_UPSERT_SQL,
  TRANSITIONS,
  DEPENDENCY_INSERT_SQL,
  TRANSITION_INSERT_SQL,
  SYNC_UPSERT_SQL,
  SYNC_RETIRE_SQL,
  UNSET_OTHER_DEFAULTS_SQL,
  RETIRE_UNDECLARED_DEFINITIONS_SQL,
} from './workflow-catalog-sync-sql.constants.js';
export { endpointCodeFor, stepEndpointCode } from './workflow-catalog-sync.rows.js';
import {
  definitionReplacements,
  dependenciesOf,
  flattenSteps,
  stageReplacements,
  stepReplacements,
  transitionReplacements,
} from './workflow-catalog-sync.rows.js';
import type { WorkflowDefinitionFixture } from './workflow-definition.types.js';

/**
 * Huella del contenido de una definición. Es lo que compara `check:process-sync`: si la fixture
 * cambió y no hay migración que la vuelva a volcar, la base desplegada tiene otra versión.
 * Se calcula sobre JSON con claves ordenadas para que reordenar propiedades no cambie la huella.
 */
export function definitionHash(fixture: WorkflowDefinitionFixture): string {
  const ordenar = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.map(ordenar);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.keys(valor as Record<string, unknown>)
          .sort()
          .map((k) => [k, ordenar((valor as Record<string, unknown>)[k])]),
      );
    }
    return valor;
  };
  return createHash('sha256')
    .update(JSON.stringify(ordenar(fixture)))
    .digest('hex')
    .slice(0, 16);
}

type Query = QueryInterface['sequelize'];

/** Una referencia a un paso que no existe es un error de la fixture, no un NULL silencioso. */
function must(ids: Map<string, string>, code: string, workflow: string): string {
  const id = ids.get(code);
  if (!id) throw new Error(`WORKFLOW_SYNC_UNKNOWN_STEP: ${workflow}.${code}`);
  return id;
}

async function idOf(sql: Query, text: string, replacements: Record<string, unknown>, transaction: Transaction): Promise<string> {
  const [rows] = await sql.query(text, { replacements, transaction });
  const row = (rows as Array<{ _id: string }>)[0];
  if (!row) throw new Error(`WORKFLOW_SYNC_ROW_NOT_FOUND: ${JSON.stringify(replacements)}`);
  return row._id;
}

type Ctx = { sql: Query; transaction: Transaction; definitionId: string; fixture: WorkflowDefinitionFixture };

async function exec(ctx: Ctx, text: string, replacements: Record<string, unknown>): Promise<void> {
  await ctx.sql.query(text, { replacements: { definitionId: ctx.definitionId, ...replacements }, transaction: ctx.transaction });
}

async function upsertStages(ctx: Ctx, now: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  // Madres antes que hijas: una subetapa necesita el `_id` de su madre.
  const stages = ctx.fixture.stages;
  for (const stage of [...stages.filter((s) => !s.parent), ...stages.filter((s) => s.parent)]) {
    const parentId = stage.parent ? must(ids, stage.parent, `${ctx.fixture.code}(etapa)`) : null;
    const replacements = stageReplacements(stage, stages.indexOf(stage), ctx.definitionId, parentId, now);
    ids.set(stage.code, await idOf(ctx.sql, STAGE_UPSERT_SQL, replacements, ctx.transaction));
  }
  return ids;
}

async function upsertSteps(ctx: Ctx, stageIds: Map<string, string>, now: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const all = flattenSteps(ctx.fixture);
  for (const [position, ref] of all.entries()) {
    const replacements = stepReplacements(ref, {
      position,
      total: all.length,
      definitionId: ctx.definitionId,
      stageId: stageIds.get(ref.stage.code)!,
      now,
    });
    ids.set(ref.step.code, await idOf(ctx.sql, STEP_UPSERT_SQL, replacements, ctx.transaction));
  }
  return ids;
}

/** Lo que la fixture ya no declara se retira (borrado lógico): el catálogo es del código. */
async function retireMissing(ctx: Ctx): Promise<void> {
  const stepCodes = flattenSteps(ctx.fixture).map((r) => r.step.code);
  await exec(
    ctx,
    `UPDATE ${STEPS} SET _deleted = true, _updated_at = NOW() WHERE workflow_definition_id = :definitionId AND step_code NOT IN (:codes) AND _deleted = false;`,
    { codes: stepCodes },
  );
  await exec(
    ctx,
    `UPDATE ${STAGES} SET _deleted = true, _updated_at = NOW() WHERE workflow_definition_id = :definitionId AND stage_code NOT IN (:codes) AND _deleted = false;`,
    {
      codes: ctx.fixture.stages.map((s) => s.code),
    },
  );
}

/** Precedencia y bifurcaciones: se reescriben enteras porque son derivadas de la fixture. */
async function rewriteGraph(ctx: Ctx, stepIds: Map<string, string>): Promise<void> {
  const id = (code: string) => must(stepIds, code, ctx.fixture.code);
  await exec(ctx, `DELETE FROM ${DEPENDENCIES} WHERE workflow_definition_id = :definitionId;`, {});
  for (const d of dependenciesOf(ctx.fixture)) {
    await exec(ctx, DEPENDENCY_INSERT_SQL, {
      stepId: id(d.step),
      dependsOn: id(d.dependsOn),
      type: d.type,
      description: d.description ?? null,
    });
  }
  await exec(ctx, `DELETE FROM ${TRANSITIONS} WHERE workflow_definition_id = :definitionId;`, {});
  for (const [index, t] of (ctx.fixture.transitions ?? []).entries()) {
    await exec(ctx, TRANSITION_INSERT_SQL, transitionReplacements(t, index, id));
  }
}

async function syncOne(sql: Query, fixture: WorkflowDefinitionFixture, appliedBy: string, transaction: Transaction): Promise<void> {
  const now = new Date().toISOString();
  // Antes del upsert: al subir de versión, la anterior sigue marcada y el índice único de «una
  // predeterminada por código» rechazaría el INSERT de la nueva.
  await sql.query(UNSET_OTHER_DEFAULTS_SQL, { replacements: { code: fixture.code, version: fixture.version }, transaction });
  const definitionId = await idOf(sql, DEFINITION_UPSERT_SQL, definitionReplacements(fixture, appliedBy, now), transaction);
  const ctx: Ctx = { sql, transaction, definitionId, fixture };
  const stageIds = await upsertStages(ctx, now);
  const stepIds = await upsertSteps(ctx, stageIds, now);
  await retireMissing(ctx);
  await rewriteGraph(ctx, stepIds);
  await exec(ctx, SYNC_UPSERT_SQL, { code: fixture.code, version: fixture.version, hash: definitionHash(fixture), appliedBy });
}

/** Lo que el registro ya no declara (proceso fusionado o eliminado) deja de figurar como activo. */
async function retireUndeclared(sql: Query, fixtures: readonly WorkflowDefinitionFixture[], transaction: Transaction): Promise<void> {
  if (fixtures.length === 0) return;
  const replacements = { codes: [...new Set(fixtures.map((fixture) => fixture.code))] };
  await sql.query(RETIRE_UNDECLARED_DEFINITIONS_SQL, { replacements, transaction });
  await sql.query(SYNC_RETIRE_SQL, { replacements, transaction });
}

/**
 * Vuelca las fixtures a la base. Idempotente: correrlo dos veces deja lo mismo. Todo en una
 * transacción: un proceso a medio escribir es peor que ninguno.
 */
export async function syncWorkflowCatalog(
  queryInterface: QueryInterface,
  fixtures: readonly WorkflowDefinitionFixture[],
  appliedBy: string,
): Promise<void> {
  const sql = queryInterface.sequelize;
  await sql.transaction(async (transaction) => {
    for (const fixture of fixtures) await syncOne(sql, fixture, appliedBy, transaction);
    await retireUndeclared(sql, fixtures, transaction);
  });
}
