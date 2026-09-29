import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PortalDataQualityService } from '../../../src/modules/internal-portal/application/portal-data-quality.service.js';
import { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import { portalDataQualityRulesQuerySchema } from '../../../src/modules/internal-portal/internal-portal.schemas.js';

type Captured = { sql: string; replacements: Record<string, unknown> };

function fakeSequelize(respond: (sql: string) => unknown[]) {
  const captured: Captured[] = [];
  const sequelize = {
    query: jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> }) => {
      captured.push({ sql, replacements: options.replacements ?? {} });
      return respond(sql);
    }),
  };
  return { sequelize, captured };
}

const scope = { tenantId: '7', allTenants: false };

describe('Reglas de calidad del portal (L6)', () => {
  it('el esquema ya no descarta severity ni status (antes los dos desplegables no filtraban)', () => {
    const parsed = portalDataQualityRulesQuerySchema.parse({ severity: 'critical', status: 'INACTIVE', q: 'tel' });
    expect(parsed).toMatchObject({ severity: 'critical', status: 'INACTIVE', q: 'tel', page: 1, limit: 20 });
    expect(() => portalDataQualityRulesQuerySchema.parse({ status: 'RUNNING' })).toThrow();
  });

  it('filtra severidad y estado en SQL, escapa q y calcula summary con el MISMO filtro', async () => {
    const { sequelize, captured } = fakeSequelize((sql) =>
      sql.includes('AS pending_issues')
        ? [{ total: '41', critical: '5', active: '40', pending_issues: '9' }]
        : [{ _id: '1', rule_code: 'DQ_X', rule_name: 'X', target_table: 't', severity: 'critical', is_active: true, open_issues: 2 }],
    );
    const service = new PortalDataQualityService(sequelize as never);

    const result = await service.listDataQualityRules(scope, { q: '50%', severity: 'critical', status: 'active', page: 2, limit: 20 });

    const [list, summary] = captured;
    for (const query of [list, summary]) {
      expect(query?.sql).toContain(`UPPER(COALESCE(r.severity, 'medium')) = :severity`);
      expect(query?.sql).toContain(`THEN 'ACTIVE' ELSE 'INACTIVE' END) = :status`);
      expect(query?.sql).toContain(`NOT IN ('resolved','ignored','closed')`);
      expect(query?.replacements).toMatchObject({ severity: 'CRITICAL', status: 'ACTIVE', like: '%50\\%%' });
    }
    expect(list?.replacements).toMatchObject({ limit: 20, offset: 20 });
    expect(result.summary).toEqual({ total: 41, critical: 5, active: 40, pendingIssues: 9 });
    expect(result.meta).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
    // Severidad en mayúsculas (la tarjeta «Críticas» comparaba contra CRITICAL y contaba 0) y sin
    // frecuencia ni dueño inventados.
    expect(result.items[0]).toMatchObject({ severity: 'CRITICAL', frequency: null, owner: null, openIssues: 2 });
  });
});

describe('POST /internal/alerts/:id/acknowledge (deprecado)', () => {
  it('es idempotente: la nota sólo se añade si todavía no estaba reconocida y la fecha no se mueve', async () => {
    const { sequelize, captured } = fakeSequelize(() => [{ _id: '103' }]);
    const service = new PortalOperationsService(sequelize as never);
    await service.acknowledgeAlert(scope, 'dq:103');
    const sql = captured[0]?.sql ?? '';
    expect(sql).toContain(`WHEN LOWER(COALESCE(i.issue_status, 'open')) = 'acknowledged' THEN i.resolution_notes`);
    expect(sql).toContain('resolved_at = COALESCE(i.resolved_at, NOW())');
    expect(sql).toContain(`NOT IN ('resolved','ignored','closed')`);
  });

  it('una incidencia ya cerrada responde 409 en vez de volver a «acknowledged»', async () => {
    const { sequelize } = fakeSequelize((sql) => (sql.startsWith('UPDATE') ? [] : [{ _id: '103' }]));
    const service = new PortalOperationsService(sequelize as never);
    await expect(service.acknowledgeAlert(scope, 'dq:103')).rejects.toThrow(ConflictException);
  });

  it('una inexistente o ajena sigue respondiendo 404', async () => {
    const { sequelize } = fakeSequelize(() => []);
    const service = new PortalOperationsService(sequelize as never);
    await expect(service.acknowledgeAlert(scope, 'dq:103')).rejects.toThrow(NotFoundException);
  });
});
