import { describe, expect, it } from '@jest/globals';
import type { QueryInterface } from 'sequelize';
import { down, up } from '../../../src/database/seeders/production/20260728140000-seed-standard-customer-credit-workflow.js';
import { CUSTOMER_CREDIT_WORKFLOW } from '../../../src/database/seed-data/customer-credit-workflow.seed-data.js';

type Executed = { sql: string; replacements: Record<string, unknown> };

/**
 * `QueryInterface` en memoria que simula lo justo de PostgreSQL para el seeder: asigna un `_id`
 * estable por clave natural en los `INSERT ... ON CONFLICT`, y reporta si la fila fue creada o
 * actualizada mediante `xmax = 0`, igual que la base real.
 *
 * No pretende ser un motor SQL: pretende demostrar que reejecutar el seeder NO crea filas nuevas y
 * que cada escritura pasa por un upsert. La idempotencia contra Postgres real la verifica el gate
 * `yarn db:seed:verify-prod-idempotency`; esto la protege en cada corrida de tests, sin base.
 */
function buildFakeQueryInterface() {
  const executed: Executed[] = [];
  const rowsByKey = new Map<string, string>();
  let sequence = 0;

  const naturalKey = (sql: string, replacements: Record<string, unknown>): string => {
    if (sql.includes('INSERT INTO workflow_definitions')) return `def:${replacements.workflowCode}:${replacements.version}`;
    if (sql.includes('INSERT INTO workflow_stages')) return `stage:${replacements.stageCode}`;
    if (sql.includes('INSERT INTO workflow_steps')) return `step:${replacements.stepCode}`;
    if (sql.includes('INSERT INTO workflow_step_dependencies')) return `dep:${replacements.stepId}:${replacements.dependsOnStepId}`;
    if (sql.includes('INSERT INTO workflow_transitions')) return `tr:${replacements.transitionCode}`;
    return '';
  };

  const query = async (sql: string, options?: { replacements?: Record<string, unknown> }) => {
    const replacements = options?.replacements ?? {};
    executed.push({ sql, replacements });

    if (sql.includes('INSERT INTO')) {
      const key = naturalKey(sql, replacements);
      const existing = rowsByKey.get(key);
      if (existing) return [{ _id: existing, inserted: false }];
      sequence += 1;
      const id = String(sequence);
      rowsByKey.set(key, id);
      return [{ _id: id, inserted: true }];
    }
    // UPDATE/DELETE: Sequelize devuelve [results, affectedCount].
    return [[], 0];
  };

  const queryInterface = { sequelize: { query, transaction: async (fn: (t: unknown) => Promise<void>) => fn({}) } };
  return { queryInterface: queryInterface as unknown as QueryInterface, executed, rowsByKey };
}

function countRows(rowsByKey: Map<string, string>, prefix: string): number {
  return [...rowsByKey.keys()].filter((key) => key.startsWith(prefix)).length;
}

describe('seeder del árbol estándar de endpoints', () => {
  it('siembra el flujo completo en la primera pasada', async () => {
    const { queryInterface, rowsByKey } = buildFakeQueryInterface();

    await up({ context: queryInterface });

    expect(countRows(rowsByKey, 'def:')).toBe(1);
    expect(countRows(rowsByKey, 'stage:')).toBeGreaterThanOrEqual(20);
    expect(countRows(rowsByKey, 'step:')).toBeGreaterThanOrEqual(50);
    expect(countRows(rowsByKey, 'dep:')).toBe(CUSTOMER_CREDIT_WORKFLOW.dependencies.length);
    expect(countRows(rowsByKey, 'tr:')).toBe(CUSTOMER_CREDIT_WORKFLOW.transitions.length);
  });

  it('es idempotente: la segunda pasada no crea ninguna fila nueva', async () => {
    const { queryInterface, rowsByKey } = buildFakeQueryInterface();

    await up({ context: queryInterface });
    const afterFirst = new Map(rowsByKey);
    await up({ context: queryInterface });

    expect(rowsByKey.size).toBe(afterFirst.size);
    // Identificadores estables: cualquier referencia externa a una etapa o paso sigue siendo válida.
    for (const [key, id] of afterFirst) expect(rowsByKey.get(key)).toBe(id);
  });

  it('toda escritura del catálogo pasa por un upsert por clave natural', async () => {
    const { queryInterface, executed } = buildFakeQueryInterface();

    await up({ context: queryInterface });

    const inserts = executed.filter((entry) => entry.sql.includes('INSERT INTO'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) expect(insert.sql).toContain('ON CONFLICT');
  });

  it('marca como borradas —sin eliminarlas— las etapas y pasos que salieron de la definición', async () => {
    const { queryInterface, executed } = buildFakeQueryInterface();

    await up({ context: queryInterface });

    const softDeletes = executed.filter((entry) => entry.sql.includes('SET _deleted = true'));
    expect(softDeletes.map((entry) => entry.sql.includes('workflow_stages'))).toContain(true);
    expect(softDeletes.map((entry) => entry.sql.includes('workflow_steps'))).toContain(true);
    for (const statement of softDeletes) expect(statement.replacements.definitionId).toBeDefined();
  });

  it('acota cada borrado de aristas a la definición sembrada', async () => {
    const { queryInterface, executed } = buildFakeQueryInterface();

    await up({ context: queryInterface });

    const deletes = executed.filter((entry) => entry.sql.trimStart().startsWith('DELETE FROM'));
    expect(deletes).toHaveLength(2);
    for (const statement of deletes) {
      expect(statement.sql).toContain('workflow_definition_id = :definitionId');
      expect(statement.replacements.definitionId).toBeDefined();
    }
  });

  it('deriva el código de endpoint en vez de escribirlo a mano', async () => {
    const { queryInterface, executed } = buildFakeQueryInterface();

    await up({ context: queryInterface });

    const submit = executed.find((entry) => entry.replacements.stepCode === 'onboarding.submit');
    expect(submit?.replacements.endpointCode).toBe('POST_CUSTOMER_ONBOARDING_BY_CUSTOMERID_SUBMIT');
  });

  it('el rollback borra la definición y deja que la cascada retire el árbol', async () => {
    const { queryInterface, executed } = buildFakeQueryInterface();

    await down({ context: queryInterface });

    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain('DELETE FROM workflow_definitions');
    expect(executed[0].replacements).toMatchObject({
      workflowCode: CUSTOMER_CREDIT_WORKFLOW.workflowCode,
      version: CUSTOMER_CREDIT_WORKFLOW.version,
    });
  });
});
