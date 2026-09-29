/**
 * @file La política de mora que Core publica al cliente, leída de PostgreSQL real tras las migraciones.
 * @business La v1 afirmaba avisos, interés penal, bloqueo de compras y reporte a la central de riesgo
 *   que el sistema no hace. La v2 los retira sin borrar la v1, que queda como histórica: la tabla
 *   existe para poder decir qué texto regía en cada fecha.
 * @system Con un tenant propio de la corrida: siembra la v1 con su migración (como la dejó la versión
 *   anterior), comprueba en negativo que el detector la caza, aplica la v2, la repite (idempotente),
 *   la revierte (`down`) y la vuelve a aplicar, leyendo cada vez con `DelinquencyPolicyService`, que
 *   es lo que responde `GET /policies/delinquency`.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { QueryTypes, type QueryInterface } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../src/database/domain-schemas.js';
import * as v1 from '../../../src/database/migrations/20260821060000-create-delinquency-policies.js';
import * as v2 from '../../../src/database/migrations/20260929200000-publish-delinquency-policy-v2.js';
import { DelinquencyPolicyModel } from '../../../src/database/models/index.js';
import { createMigrationSequelizeInstance } from '../../../src/database/sequelize.js';
import { DelinquencyPolicyService } from '../../../src/modules/loans/application/delinquency-policy.service.js';
import { findUnbackedClaims } from '../../../src/modules/loans/domain/delinquency-policy-claims.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

const POLICIES = `${atlasSchemaFor('delinquency_policies')}.delinquency_policies`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

type Row = { _id: string; version_code: string; status: string; body_md: string; effective_from: string; effective_until: string | null };

let database: IntegrationDatabase | null = null;
let migrator: Sequelize | null = null;
let context: QueryInterface;
let tenantId = '';
let service: DelinquencyPolicyService;

async function rows(): Promise<Row[]> {
  return migrator!.query<Row>(
    `SELECT _id::text, version_code, status, body_md, effective_from::text, effective_until::text
     FROM ${POLICIES} WHERE _tenant_id = :tenantId AND policy_code = 'mora_e_intereses' AND _deleted = false ORDER BY version_code`,
    { type: QueryTypes.SELECT, replacements: { tenantId } },
  );
}

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  migrator = createMigrationSequelizeInstance();
  context = migrator.getQueryInterface();
  service = new DelinquencyPolicyService(DelinquencyPolicyModel);
  const [created] = await migrator.query<{ _id: string }>(`INSERT INTO ${TENANTS} (_created_at) VALUES (NOW()) RETURNING _id::text`, {
    type: QueryTypes.SELECT,
  });
  tenantId = created._id;
  // El tenant nace sin política; la migración de la v1 le siembra la suya, como en una base anterior a la v2.
  await v1.up({ context });
});

afterAll(async () => {
  if (migrator) {
    // Pase lo que pase, la base queda con la v2 aplicada, que es su estado al día.
    await v2.up({ context });
    if (tenantId) {
      await migrator.query(`DELETE FROM ${POLICIES} WHERE _tenant_id = :tenantId`, { replacements: { tenantId } });
      await migrator.query(`DELETE FROM ${TENANTS} WHERE _id = :tenantId`, { replacements: { tenantId } });
    }
  }
  await migrator?.close();
  await database?.close();
});

describe('política de mora publicada · v1 → v2', () => {
  let v1Body = '';

  it('antes de la v2: lo publicado es la v1, y el detector encuentra sus afirmaciones sin respaldo', async () => {
    if (!database) return;
    const before = await rows();
    expect(before.map((row) => [row.version_code, row.status])).toEqual([['v1', 'active']]);
    v1Body = before[0].body_md;

    const published = await service.current(tenantId);
    expect(published.versionCode).toBe('v1');
    const claims = new Set(findUnbackedClaims(published).map((finding) => finding.claim));
    expect([...claims].sort()).toEqual(
      [
        'el caso pasa a cobranza',
        'interés penal o moratorio',
        'reporte a una central de riesgo',
        'se envía un recordatorio',
        'se suspenden las compras',
      ].sort(),
    );
  });

  it('`up`: publica la v2 sin afirmaciones sin respaldo y conserva la v1 intacta como sustituida', async () => {
    if (!database) return;
    await v2.up({ context });

    const published = await service.current(tenantId);
    expect(published.versionCode).toBe('v2');
    expect(published.bodyMarkdown).toBe(v2.DELINQUENCY_POLICY_V2.bodyMarkdown);
    expect(published.stages).toEqual(v2.DELINQUENCY_POLICY_V2.stages);
    expect(findUnbackedClaims(published)).toEqual([]);

    const after = await rows();
    expect(after.map((row) => [row.version_code, row.status])).toEqual([
      ['v1', 'superseded'],
      ['v2', 'active'],
    ]);
    // El texto legal ya publicado no se reescribe: sólo se cierra su vigencia el día antes de la v2.
    expect(after[0].body_md).toBe(v1Body);
    const dayBefore = new Date(`${after[1].effective_from}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    expect(after[0].effective_until).toBe(dayBefore.toISOString().slice(0, 10));
    expect(after[1].effective_from).toBe(new Date().toISOString().slice(0, 10));
  });

  it('`up` repetido no duplica ni mueve nada', async () => {
    if (!database) return;
    const first = await rows();
    await v2.up({ context });
    expect(await rows()).toEqual(first);
  });

  it('`down` devuelve la v1 vigente y retira la v2; `up` la vuelve a publicar', async () => {
    if (!database) return;
    await v2.down({ context });
    const reverted = await rows();
    expect(reverted.map((row) => [row.version_code, row.status, row.effective_until])).toEqual([['v1', 'active', null]]);
    expect(reverted[0].body_md).toBe(v1Body);
    expect((await service.current(tenantId)).versionCode).toBe('v1');

    await v2.up({ context });
    const published = await service.current(tenantId);
    expect(published.versionCode).toBe('v2');
    expect(findUnbackedClaims(published)).toEqual([]);
  });
});
