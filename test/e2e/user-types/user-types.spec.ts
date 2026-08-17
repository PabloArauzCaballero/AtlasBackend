import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ATLAS_USER_ROLES, type AtlasUserRole } from '../../../src/common/types/auth.types.js';
import {
  INTERNAL_ROLE_CODES,
  ROLE_PERMISSION_CODES,
  legacyRoleForInternalRoles,
  type InternalRoleCode,
} from '../../../src/modules/internal-users/internal-rbac.seed-data.js';
import { DATA_NOTEBOOK_ROLES } from '../../../src/modules/data-notebook/data-notebook.constants.js';
import {
  SYSTEMS_OPS_GOVERNANCE_ROLES,
  SYSTEMS_OPS_QA_ROLES,
  SYSTEMS_OPS_STRESS_ROLES,
} from '../../../src/modules/systems-ops/systems-ops.constants.js';
import {
  PROBE_PERMISSIONS,
  bearer,
  buildNotificationsSelfServiceApp,
  buildUserTypesTestApp,
  customerToken,
  internalToken,
  internalUserIdFor,
  platformToken,
  signToken,
  type NotificationsServiceStub,
  type ProbePermissionKey,
} from './support/user-types-test-app.js';

/**
 * Smoke tests por TIPO DE USUARIO, sin base de datos: recorren por HTTP los tres vocabularios de
 * identidad de Atlas (tipo de actor, rol legacy del token y rol RBAC interno) contra los guards
 * reales. Complementan `scripts/smoke/user-types.smoke.ts`, que hace el mismo recorrido contra un
 * servidor y una base reales.
 */

const PROBE_KEYS = Object.keys(PROBE_PERMISSIONS) as ProbePermissionKey[];

/** Roles legacy que un usuario interno REAL puede llegar a tener (los produce el mapeo RBAC→legacy). */
const REACHABLE_INTERNAL_LEGACY_ROLES = [...new Set(INTERNAL_ROLE_CODES.map((code) => legacyRoleForInternalRoles([code])))];

describe('tipos de usuario — cadena de guards real (e2e/supertest)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildUserTypesTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('identidad: qué se acepta como token', () => {
    it('rechaza con 401 una petición sin token', async () => {
      await request(app.getHttpServer()).get('/probe/roles/any').expect(401);
    });

    it('rechaza con 401 un Authorization mal formado (sin esquema Bearer)', async () => {
      await request(app.getHttpServer()).get('/probe/roles/any').set('Authorization', 'Token abc').expect(401);
    });

    it('rechaza con 401 un token firmado con otro secreto', async () => {
      const foreign = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: 'x', role: 'admin' })).toString('base64url'),
        'firma-invalida',
      ].join('.');
      await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(foreign))
        .expect(401);
    });

    it('rechaza con 401 un token cuyo rol no pertenece al vocabulario de Atlas', async () => {
      const token = signToken('super_usuario' as AtlasUserRole, { tenantId: '1' });
      await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(token))
        .expect(401);
    });
  });

  describe('rol legacy del token: los 13 roles de ATLAS_USER_ROLES', () => {
    it.each(ATLAS_USER_ROLES)('%s se autentica y el guard conserva su rol', async (role) => {
      const res = await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(signToken(role, { tenantId: '1' })))
        .expect(200);

      expect(res.body.role).toBe(role);
      expect(res.body.sub).toBe('e2e-user-types');
    });

    it.each(ATLAS_USER_ROLES)('%s recibe 200 o 403 en un endpoint @Roles(admin, platform_admin) según su rol', async (role) => {
      const expected = role === 'admin' || role === 'platform_admin' ? 200 : 403;
      await request(app.getHttpServer())
        .get('/probe/roles/admin-only')
        .set(...bearer(signToken(role, { tenantId: '1' })))
        .expect(expected);
    });

    it('ningún rol interno alcanza un endpoint reservado a `customer`', async () => {
      for (const role of ATLAS_USER_ROLES.filter((item) => item !== 'customer')) {
        await request(app.getHttpServer())
          .get('/probe/roles/customer-only')
          .set(...bearer(signToken(role, { tenantId: '1' })))
          .expect(403);
      }
    });
  });

  describe('tipo de actor: customer, internal_user y platform_user', () => {
    it('el token de cliente llega al handler con customerId y tenantId', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(customerToken()))
        .expect(200);

      expect(res.body).toMatchObject({ role: 'customer', customerId: 'cust-1', tenantId: '1' });
      expect(res.body.internalUserId).toBeUndefined();
      expect(res.body.platformUserId).toBeUndefined();
    });

    it('el token de usuario interno llega al handler con internalUserId y tenantId', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(internalToken('internal_operator')))
        .expect(200);

      expect(res.body).toMatchObject({ role: 'internal_operator', internalUserId: 'iu-1', tenantId: '1' });
      expect(res.body.customerId).toBeUndefined();
    });

    it('el token de plataforma llega sin tenantId (opera sobre cualquier tenant)', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(platformToken()))
        .expect(200);

      expect(res.body).toMatchObject({ role: 'platform_admin', platformUserId: 'pu-1' });
      expect(res.body.tenantId).toBeUndefined();
    });
  });

  describe('aislamiento por tenant (TenantGuard)', () => {
    it('acepta el header x-tenant-id cuando coincide con el tenant del token', async () => {
      await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(customerToken()))
        .set('x-tenant-id', '1')
        .expect(200);
    });

    it('rechaza con 403 el header x-tenant-id de OTRO tenant (anti cross-tenant)', async () => {
      await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(customerToken()))
        .set('x-tenant-id', '2')
        .expect(403);
    });

    it('el usuario de plataforma no queda atado a un tenant: cualquier x-tenant-id pasa', async () => {
      await request(app.getHttpServer())
        .get('/probe/roles/any')
        .set(...bearer(platformToken()))
        .set('x-tenant-id', '99')
        .expect(200);
    });
  });

  describe('RBAC interno: los 20 roles de INTERNAL_ROLE_CODES', () => {
    it('cubre exactamente los roles declarados en el catálogo', () => {
      expect(INTERNAL_ROLE_CODES).toHaveLength(20);
      expect(Object.keys(ROLE_PERMISSION_CODES).sort()).toEqual([...INTERNAL_ROLE_CODES].sort());
    });

    const cases = INTERNAL_ROLE_CODES.flatMap((roleCode) => PROBE_KEYS.map((probe) => [roleCode, probe] as const));

    it.each(cases)('%s en /probe/internal/%s responde según ROLE_PERMISSION_CODES', async (roleCode, probe) => {
      const granted = ROLE_PERMISSION_CODES[roleCode].includes(PROBE_PERMISSIONS[probe]);
      await request(app.getHttpServer())
        .get(`/probe/internal/${probe}`)
        .set(...bearer(internalToken(legacyRoleForInternalRoles([roleCode]), { internalUserId: internalUserIdFor(roleCode) })))
        .expect(granted ? 200 : 403);
    });

    it.each(INTERNAL_ROLE_CODES)('%s siempre puede leer su propio perfil (auth.internal.me.read)', async (roleCode) => {
      await request(app.getHttpServer())
        .get('/probe/internal/me')
        .set(...bearer(internalToken(legacyRoleForInternalRoles([roleCode]), { internalUserId: internalUserIdFor(roleCode) })))
        .expect(200);
    });

    it('solo los administradores de identidad gestionan usuarios internos', async () => {
      const withUsersRead = INTERNAL_ROLE_CODES.filter((roleCode) => ROLE_PERMISSION_CODES[roleCode].includes(PROBE_PERMISSIONS.users));
      expect(withUsersRead.sort()).toEqual(['AUDITOR_READONLY', 'INTERNAL_IDENTITY_ADMIN', 'SUPER_ADMIN', 'SYSTEMS_ADMIN']);
    });

    it('un token de cliente nunca atraviesa InternalPermissionsGuard (no es sesión interna)', async () => {
      await request(app.getHttpServer())
        .get('/probe/internal/me')
        .set(...bearer(customerToken()))
        .expect(403);
    });

    it('un token interno SIN internalUserId es rechazado con 403 aunque el rol sea admin', async () => {
      await request(app.getHttpServer())
        .get('/probe/internal/me')
        .set(...bearer(signToken('admin', { tenantId: '1' })))
        .expect(403);
    });

    it('un token de plataforma no sustituye a una sesión interna (le falta tenantId/internalUserId)', async () => {
      await request(app.getHttpServer())
        .get('/probe/internal/me')
        .set(...bearer(platformToken()))
        .expect(403);
    });
  });

  describe('coherencia entre el RBAC interno y el claim `role` del token', () => {
    it('todo rol legacy derivado de un rol RBAC pertenece al vocabulario que acepta el guard', () => {
      const known = new Set<string>(ATLAS_USER_ROLES);
      const unknown = REACHABLE_INTERNAL_LEGACY_ROLES.filter((role) => !known.has(role));
      expect(unknown).toEqual([]);
    });

    it('cada rol RBAC produce un rol legacy estable y determinista', () => {
      for (const roleCode of INTERNAL_ROLE_CODES) {
        const first = legacyRoleForInternalRoles([roleCode]);
        expect(legacyRoleForInternalRoles([roleCode])).toBe(first);
      }
      expect(REACHABLE_INTERNAL_LEGACY_ROLES.sort()).toEqual([
        'admin',
        'compliance_analyst',
        'fraud_analyst',
        'internal_operator',
        'qa_engineer',
        'readonly_auditor',
        'risk_analyst',
      ]);
    });

    it('la combinación de roles privilegiados gana sobre la de menor privilegio', () => {
      expect(legacyRoleForInternalRoles(['SUPPORT_AGENT', 'SUPER_ADMIN'])).toBe('admin');
      expect(legacyRoleForInternalRoles(['SUPPORT_AGENT', 'RISK_ANALYST'])).toBe('risk_analyst');
      expect(legacyRoleForInternalRoles([])).toBe('internal_operator');
    });

    /**
     * Un `@Roles(...)` que solo admite roles que NINGÚN usuario interno puede llegar a tener deja
     * el endpoint inalcanzable para el personal del tenant: la puerta existe pero no hay llave.
     * `system_admin` es exactamente ese caso — está en el vocabulario del token, pero
     * `legacyRoleForInternalRoles` nunca lo produce (SUPER_ADMIN y SYSTEMS_ADMIN se mapean a
     * `admin`), así que las listas de systems-ops deben incluir además un rol alcanzable.
     *
     * `DATA_NOTEBOOK_ROLES` está aquí por completitud, pero OJO: esta prueba no habría cazado el
     * fallo que le tocó a esa lista. Admitía `risk_analyst`, `compliance_analyst` y
     * `readonly_auditor` —tres llaves alcanzables de sobra—, y aun así el administrador del tenant
     * recibía 403, porque `admin` no estaba. «Al menos uno» no dice nada de QUIÉN falta. Ese caso
     * lo fija la prueba de abajo, que nombra al rol concreto.
     */
    const gatedRoleLists: [string, readonly string[]][] = [
      ['SYSTEMS_OPS_GOVERNANCE_ROLES', SYSTEMS_OPS_GOVERNANCE_ROLES],
      ['SYSTEMS_OPS_QA_ROLES', SYSTEMS_OPS_QA_ROLES],
      ['SYSTEMS_OPS_STRESS_ROLES', SYSTEMS_OPS_STRESS_ROLES],
      ['DATA_NOTEBOOK_ROLES', DATA_NOTEBOOK_ROLES],
    ];

    it.each(gatedRoleLists)('%s es alcanzable por al menos un usuario interno real', (_name, roles) => {
      expect(REACHABLE_INTERNAL_LEGACY_ROLES.filter((role) => roles.includes(role))).not.toEqual([]);
    });

    /**
     * El cuaderno de datos se le negaba al superadministrador del tenant.
     *
     * `DATA_NOTEBOOK_ROLES` nombraba `system_admin` y `platform_admin`, que suenan a «el que manda»
     * y no los lleva ningún usuario interno: los tres roles RBAC de administración colapsan en
     * `admin` (`legacyRoleForInternalRoles`). El resultado era un 403 en el catálogo de datasets
     * que el portal sólo podía contar como «el servicio no responde o tu sesión caducó» —ninguna de
     * las dos—, así que el aviso mandaba a revisar el servicio y la sesión, que estaban bien.
     *
     * Se comprueba por los tres códigos RBAC y no por el literal `'admin'`: si algún día el mapeo
     * cambia y SYSTEMS_ADMIN pasa a emitir `system_admin`, esta prueba sigue diciendo la verdad.
     */
    it.each(['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'INTERNAL_IDENTITY_ADMIN'])(
      'el administrador interno %s puede abrir el cuaderno de datos',
      (roleCode) => {
        expect(DATA_NOTEBOOK_ROLES).toContain(legacyRoleForInternalRoles([roleCode]));
      },
    );

    /**
     * Lo mismo, pero pasando por el guard de verdad y por HTTP.
     *
     * La aserción de arriba mira una constante; ésta emite un token como el que lleva el
     * administrador de un tenant y comprueba que `RolesGuard` lo deja entrar — y que a QA, que no
     * está en la lista, lo sigue parando. Sin el segundo caso, la prueba pasaría también con una
     * lista abierta de par en par.
     */
    it('un token de administrador interno atraviesa el guard del cuaderno, y el de QA no', async () => {
      const app = await buildUserTypesTestApp();
      try {
        await request(app.getHttpServer())
          .get('/probe/roles/data-notebook')
          .set(...bearer(internalToken(legacyRoleForInternalRoles(['SUPER_ADMIN']))))
          .expect(200);
        await request(app.getHttpServer())
          .get('/probe/roles/data-notebook')
          .set(...bearer(internalToken(legacyRoleForInternalRoles(['QA_ENGINEER']))))
          .expect(403);
      } finally {
        await app.close();
      }
    });
  });
});

describe('tipos de usuario — autoservicio en el NotificationsController real (e2e/supertest)', () => {
  let app: INestApplication;
  let service: NotificationsServiceStub;

  beforeAll(async () => {
    ({ app, service } = await buildNotificationsSelfServiceApp());
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Regresión de la clase de bug que ya golpeó a este controlador: su lista de roles de
   * autoservicio omitía roles legacy que usuarios internos reales SÍ tienen, y esos usuarios
   * recibían 403 al abrir su propio inbox. La prueba recorre los 20 roles RBAC, no una lista
   * escrita a mano, así que un rol nuevo en el catálogo entra automáticamente en la cobertura.
   */
  it.each(INTERNAL_ROLE_CODES)('el rol interno %s puede leer su propio inbox', async (roleCode: InternalRoleCode) => {
    const legacyRole = legacyRoleForInternalRoles([roleCode]);
    await request(app.getHttpServer())
      .get('/internal-users/me/notifications')
      .set(...bearer(internalToken(legacyRole, { internalUserId: internalUserIdFor(roleCode) })))
      .expect(200);

    expect(service.listMyNotifications).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ page: 1, limit: 20 }),
      expect.objectContaining({ internalUserId: internalUserIdFor(roleCode) }),
    );
  });

  it('el inbox interno no se abre a un token de cliente', async () => {
    await request(app.getHttpServer())
      .get('/internal-users/me/notifications')
      .set(...bearer(customerToken()))
      .expect(403);
  });

  it('el inbox de un cliente no se abre a un rol interno sin permiso administrativo', async () => {
    await request(app.getHttpServer())
      .get('/customers/1/notifications')
      .set(...bearer(internalToken('risk_analyst')))
      .expect(403);
  });
});
