import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PortalOperationsService } from '../../../src/modules/internal-portal/application/portal-operations.service.js';
import { portalScopeFor, tenantPredicate } from '../../../src/modules/internal-portal/application/portal-scope.util.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * ATLAS-SEC-009 — aislamiento por tenant del portal interno.
 *
 * El portal consulta `system_job_runs` y `data_quality_issues`, las dos con `_tenant_id`, y lo hacía
 * sin filtrarlo. Verificado explotable contra la API real
 * (`docs/audit/evidence/live-exploit-2026-08-06.md`): un `admin` del tenant 1 leyó una corrida de job
 * del tenant 2 y cambió el estado de una alerta del tenant 2.
 *
 * Estas pruebas fijan las dos mitades del arreglo: que el SQL lleva el predicado de tenant, y que la
 * escritura lo lleva EN SU PROPIO `WHERE` (no en una comprobación previa, que dejaría una ventana
 * entre "verifico" y "escribo").
 */
type CapturedQuery = { sql: string; replacements: Record<string, unknown> };

function buildOperations(rows: Record<string, unknown>[] = []) {
  const captured: CapturedQuery[] = [];
  const sequelize = {
    query: jest.fn(async (sql: string, options: { replacements?: Record<string, unknown> }) => {
      captured.push({ sql, replacements: options.replacements ?? {} });
      if (/COUNT\(\*\)/.test(sql)) return [{ count: String(rows.length) }];
      return rows;
    }),
  };
  return { service: new PortalOperationsService(sequelize as never), captured };
}

const tenantUser = { sub: '1', role: 'internal_operator', tenantId: '7' } as AuthenticatedUser;
const platformUser = { sub: '2', role: 'platform_admin' } as AuthenticatedUser;

describe('portalScopeFor', () => {
  it('un rol de tenant queda acotado a su tenant', () => {
    expect(portalScopeFor(tenantUser)).toEqual({ tenantId: '7', allTenants: false });
  });

  it('un rol de plataforma ve todos los tenants', () => {
    expect(portalScopeFor(platformUser)).toEqual({ tenantId: null, allTenants: true });
  });

  /**
   * `admin` es el rol legacy que reciben SUPER_ADMIN, SYSTEMS_ADMIN e INTERNAL_IDENTITY_ADMIN
   * (ver `systems-ops.constants.ts`): todos ellos administran UN tenant. Darle alcance global
   * reabriría la fuga por la puerta de al lado, así que se fija aquí explícitamente.
   */
  it('admin NO es un rol de plataforma: sigue acotado a su tenant', () => {
    const scope = portalScopeFor({ sub: '3', role: 'admin', tenantId: '7' } as AuthenticatedUser);
    expect(scope).toEqual({ tenantId: '7', allTenants: false });
  });

  it('un rol de tenant sin tenantId en el token falla cerrado', () => {
    expect(() => portalScopeFor({ sub: '4', role: 'internal_operator' } as AuthenticatedUser)).toThrow(ForbiddenException);
  });
});

describe('tenantPredicate', () => {
  it('parametriza el tenant en vez de interpolarlo', () => {
    expect(tenantPredicate({ tenantId: '7', allTenants: false }, 'j')).toBe('j._tenant_id = CAST(:scopeTenantId AS BIGINT)');
  });

  it('no restringe a los roles de plataforma', () => {
    expect(tenantPredicate({ tenantId: null, allTenants: true }, 'j')).toBe('TRUE');
  });
});

describe('PortalOperationsService — contención por tenant', () => {
  it('listJobs filtra por tenant y cuenta con el MISMO where que la página', async () => {
    const { service, captured } = buildOperations([]);
    await service.listJobs(portalScopeFor(tenantUser), { page: 1, limit: 20 });

    expect(captured).toHaveLength(2);
    for (const query of captured) {
      expect(query.sql).toContain('j._tenant_id = CAST(:scopeTenantId AS BIGINT)');
      expect(query.replacements.scopeTenantId).toBe('7');
    }
    // El conteo tiene que llevar el filtro de texto igual que la página: contando la tabla entera,
    // `totalPages` prometía páginas vacías al buscar.
    const [page, count] = captured;
    expect(count.sql).toContain(':q =');
    expect(count.sql).toContain('ILIKE :like');
    expect(page.replacements.like).toBe(count.replacements.like);
  });

  it('listAlerts filtra por tenant', async () => {
    const { service, captured } = buildOperations([]);
    await service.listAlerts(portalScopeFor(tenantUser), { page: 1, limit: 20 });

    for (const query of captured) {
      expect(query.sql).toContain('i._tenant_id = CAST(:scopeTenantId AS BIGINT)');
      expect(query.replacements.scopeTenantId).toBe('7');
    }
  });

  it('getJob de otro tenant responde 404, no el contenido ajeno', async () => {
    const { service } = buildOperations([]);
    await expect(service.getJob(portalScopeFor(tenantUser), '125')).rejects.toThrow(NotFoundException);
  });

  it('acknowledgeAlert lleva el tenant en el WHERE del propio UPDATE', async () => {
    const { service, captured } = buildOperations([{ _id: '103' }]);
    await service.acknowledgeAlert(portalScopeFor(tenantUser), 'dq:103');

    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('UPDATE data_quality_issues');
    expect(captured[0].sql).toContain('i._tenant_id = CAST(:scopeTenantId AS BIGINT)');
    expect(captured[0].replacements).toMatchObject({ id: '103', scopeTenantId: '7' });
  });

  it('acknowledgeAlert sobre una alerta ajena no afecta filas y responde 404', async () => {
    const { service } = buildOperations([]);
    await expect(service.acknowledgeAlert(portalScopeFor(tenantUser), 'dq:103')).rejects.toThrow(NotFoundException);
  });

  it('un rol de plataforma no queda restringido', async () => {
    const { service, captured } = buildOperations([]);
    await service.listJobs(portalScopeFor(platformUser), { page: 1, limit: 20 });

    expect(captured[0].sql).not.toContain('scopeTenantId');
    expect(captured[0].replacements.scopeTenantId).toBeUndefined();
  });
});
