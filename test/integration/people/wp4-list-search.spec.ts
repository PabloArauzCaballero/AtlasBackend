/**
 * WP4 · búsquedas de personas, soporte y archivos contra PostgreSQL REAL.
 *
 * Lo que un doble no demuestra: que las subconsultas escritas a mano (rol asignado, comercio por su
 * ficha, cliente por su código, título de la versión vigente) casan con el esquema de verdad, que los
 * `replacements` también llegan al `COUNT` de `findAndCountAll`, y que `%`/`_` no actúan de comodín.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import {
  CustomerModel,
  ExpedienteModel,
  InternalRoleModel,
  InternalUserModel,
  InternalUserRoleModel,
  KnowledgeArticleModel,
  KnowledgeArticleVersionModel,
  PartnerProfileModel,
  SupportCaseEventModel,
  SupportCaseModel,
} from '../../../src/database/models/index.js';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';
import { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import { SupportCaseRepository } from '../../../src/modules/support/support-case.repository.js';
import { SupportKnowledgeReadService } from '../../../src/modules/support/application/support-knowledge-read.service.js';
import { buildLoanBookHarness, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let h: LoanBookHarness | null = null;
const token = runToken().toUpperCase();
const roleIds: string[] = [];

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) h = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  try {
    if (h && database) {
      const tenantId = h.tenantId;
      await KnowledgeArticleModel.update({ currentVersionId: null } as never, { where: { tenantId } });
      await KnowledgeArticleVersionModel.destroy({ where: { tenantId } });
      await KnowledgeArticleModel.destroy({ where: { tenantId } });
      // Los casos de soporte son append-only (el disparador rechaza DELETE): se dan de baja lógica.
      await SupportCaseModel.update({ deleted: true } as never, { where: { tenantId } });
      await ExpedienteModel.destroy({ where: { tenantId } });
      await PartnerProfileModel.destroy({ where: { tenantId } });
      await InternalUserRoleModel.destroy({ where: { tenantId } });
      await InternalUserModel.destroy({ where: { tenantId } });
      if (roleIds.length) await InternalRoleModel.destroy({ where: { id: roleIds } });
    }
  } finally {
    await h?.cleanup().catch(() => undefined);
    await database?.close();
  }
});

async function insert(sql: string, replacements: Record<string, unknown>): Promise<string> {
  const [row] = await database!.sequelize.query<{ id: string }>(`${sql} RETURNING _id AS id`, { replacements, type: QueryTypes.SELECT });
  return String(row!.id);
}

describe('WP4 · búsquedas en el servidor (PostgreSQL real)', () => {
  it('usuarios internos: q por rol asignado vivo y filtro por rol; el total cuenta el filtro, no la página', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const now = new Date();
    const roleCode = `WP4_${token}`;
    const roleId = await insert(
      `INSERT INTO internal_roles (role_code, role_name, legacy_role_code, status, _deleted, _created_at) VALUES (:roleCode, 'WP4', 'admin', 'active', false, NOW())`,
      { roleCode },
    );
    roleIds.push(roleId);
    const usuario = (email: string, fullName: string) =>
      InternalUserModel.create({
        tenantId,
        email,
        fullName,
        userCode: `U${randomUUID().slice(0, 8)}`,
        status: 'active',
        createdAtValue: now,
        deleted: false,
      } as never);
    const conRol = await usuario(`ana.${token}@wp4.test`.toLowerCase(), 'Ana Rol');
    const revocado = await usuario(`beto.${token}@wp4.test`.toLowerCase(), 'Beto Revocado');
    await usuario(`caro_${token}@wp4.test`.toLowerCase(), 'Caro Sin Rol');
    await insert(
      `INSERT INTO internal_user_roles (_tenant_id, internal_user_id, role_id, _created_at) VALUES (:tenantId, :userId, :roleId, NOW())`,
      {
        tenantId,
        userId: conRol.id,
        roleId,
      },
    );
    await insert(
      `INSERT INTO internal_user_roles (_tenant_id, internal_user_id, role_id, revoked_at, _created_at) VALUES (:tenantId, :userId, :roleId, NOW(), NOW())`,
      { tenantId, userId: revocado.id, roleId },
    );
    const repo = new InternalRbacRepository(
      database.sequelize,
      InternalUserModel,
      InternalRoleModel,
      {} as never,
      {} as never,
      InternalUserRoleModel,
      {} as never,
      {} as never,
    );

    const porRol = await repo.listUsers(tenantId, { page: 1, limit: 1 }, { role: roleCode });
    expect(porRol.rows.map((row) => String(row.id))).toEqual([String(conRol.id)]);
    expect(porRol.total).toBe(1);

    const porTexto = await repo.listUsers(tenantId, { page: 1, limit: 50 }, { q: roleCode.slice(2).toLowerCase() });
    expect(porTexto.rows.map((row) => String(row.id))).toEqual([String(conRol.id)]);

    // El «_» de caro_… es literal: «caro_» no casa con «caroX».
    const guion = await repo.listUsers(tenantId, { page: 1, limit: 50 }, { q: `caro_${token}`.toLowerCase() });
    expect(guion.total).toBe(1);
    const comodin = await repo.listUsers(tenantId, { page: 1, limit: 50 }, { q: '%' });
    expect(comodin.total).toBe(0);
    const paginado = await repo.listUsers(tenantId, { page: 1, limit: 1 }, { q: `${token}@wp4`.toLowerCase() });
    expect(paginado.rows).toHaveLength(1);
    expect(paginado.total).toBe(3);
  });

  it('archivos: un expediente de comercio se encuentra por razón social y NIT de su ficha viva', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const now = new Date();
    const partner = await PartnerProfileModel.create(
      {
        tenantId,
        legalName: `Distribuidora ${token} SRL`,
        tradeName: 'Nombre Nuevo',
        taxId: `NIT${token}`,
        contactEmail: `c.${token}@wp4.test`.toLowerCase(),
        createdAtValue: now,
        updatedAtValue: now,
      } as never,
      { validate: false },
    );
    await ExpedienteModel.create({
      tenantId,
      subjectType: 'partner',
      subjectId: partner.id,
      customerCode: 'Nombre Viejo',
      estado: 'abierto',
    } as never);
    const repo = new ExpedientesRepository(ExpedienteModel, {} as never, {} as never);

    const porRazon = await repo.listarExpedientes({ tenantId, q: `distribuidora ${token}`.toLowerCase(), offset: 0, limit: 10 });
    expect(porRazon.count).toBe(1);
    expect(porRazon.rows[0]!.subjectType).toBe('partner');
    const porNit = await repo.listarExpedientes({ tenantId, q: `NIT${token}`, offset: 0, limit: 10 });
    expect(porNit.count).toBe(1);
    const nada = await repo.listarExpedientes({ tenantId, q: `${token}_X`, offset: 0, limit: 10 });
    expect(nada.count).toBe(0);
  });

  it('soporte: q por código de cliente y asunto; el resumen cuenta el filtro entero con la visibilidad', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const now = new Date();
    const customer = await CustomerModel.create({
      tenantId,
      customerCode: `CLI${token}`,
      customerUuid: randomUUID(),
      lifecycleStatus: 'active',
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    } as never);
    const caso = (sufijo: string, extra: Record<string, unknown>) =>
      SupportCaseModel.create(
        {
          tenantId,
          caseNumber: `SUP-${token}-${sufijo}`,
          subjectContextType: 'CONSUMER',
          openedByActorType: 'CUSTOMER',
          openedByActorId: '1',
          caseType: 'INQUIRY',
          title: `Asunto ${sufijo}`,
          status: 'NEW',
          priority: 'P3',
          openedAt: now,
          lastActivityAt: now,
          deleted: false,
          ...extra,
        } as never,
        { validate: false },
      );
    await caso('A', { subjectCustomerId: customer.id, priority: 'P1' });
    await caso('B', { subjectCustomerId: customer.id, sensitivity: 'RESTRICTED', currentAssigneeAgentId: null });
    await caso('C', { title: 'Pregunta 100% distinta', subjectContextType: 'INTERNAL' });
    const repo = new SupportCaseRepository(database.sequelize, SupportCaseModel, SupportCaseEventModel);
    const agente = { agentProfileId: '999999', isSupervisor: false };

    const porCliente = await repo.listCases({ tenantId, q: `cli${token}`.toLowerCase(), restrictedVisibleTo: agente, limit: 20 });
    expect(porCliente.map((row) => row.caseNumber)).toEqual([`SUP-${token}-A`]);
    const supervisor = await repo.summarizeCases({
      tenantId,
      q: `cli${token}`.toLowerCase(),
      restrictedVisibleTo: { ...agente, isSupervisor: true },
    });
    expect(supervisor).toEqual({ total: 2, highPriority: 1, unassigned: 2 });
    const visible = await repo.summarizeCases({ tenantId, q: `CLI${token}`, restrictedVisibleTo: agente });
    expect(visible.total).toBe(1);

    expect((await repo.listCases({ tenantId, q: '100%', limit: 20 })).map((row) => row.caseNumber)).toEqual([`SUP-${token}-C`]);
    expect(await repo.summarizeCases({ tenantId, q: `o' OR 1=1 --` })).toEqual({ total: 0, highPriority: 0, unassigned: 0 });
  });

  it('base de conocimiento: busca por el título de la versión VIGENTE y lo devuelve', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const article = await KnowledgeArticleModel.create(
      {
        tenantId,
        articleKey: `k-${token}`.toLowerCase(),
        audience: 'PUBLIC_CONSUMER',
        status: 'PUBLISHED',
        ownerTeam: 'SOPORTE',
        deleted: false,
      } as never,
      { validate: false },
    );
    const version = await KnowledgeArticleVersionModel.create(
      {
        tenantId,
        articleId: article.id,
        versionNumber: 1,
        locale: 'es-BO',
        status: 'PUBLISHED',
        title: `El código ${token} no llega`,
        bodyMarkdown: 'texto',
        checksum: 'x'.repeat(64),
      } as never,
      { validate: false },
    );
    await article.update({ currentVersionId: version.id } as never);
    const service = new SupportKnowledgeReadService(KnowledgeArticleModel, KnowledgeArticleVersionModel);

    const page = await service.listArticles(tenantId, { search: `código ${token}`.toLowerCase(), page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ articleKey: `k-${token}`.toLowerCase(), currentTitle: `El código ${token} no llega` });
  });
});
