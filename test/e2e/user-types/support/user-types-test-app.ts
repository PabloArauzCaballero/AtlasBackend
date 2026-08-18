import { jest } from '@jest/globals';
import { Controller, Get, INestApplication, Provider, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { CurrentUser } from '../../../../src/common/decorators/current-user.decorator.js';
import { Roles } from '../../../../src/common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../../src/common/services/token-revocation.service.js';
import type { AtlasUserRole, AuthenticatedUser } from '../../../../src/common/types/auth.types.js';
import { accessTokenSignOptions } from '../../../../src/common/utils/auth/jwt-claims.util.js';
import { env } from '../../../../src/config/env.js';
import { DATA_NOTEBOOK_ROLES } from '../../../../src/modules/data-notebook/data-notebook.constants.js';
import { InternalPermissions } from '../../../../src/modules/internal-users/internal-permissions.decorator.js';
import { InternalPermissionsGuard } from '../../../../src/modules/internal-users/guards/internal-permissions.guard.js';
import { InternalRbacRepository } from '../../../../src/modules/internal-users/internal-rbac.repository.js';
import { ROLE_PERMISSION_CODES, type InternalRoleCode } from '../../../../src/modules/internal-users/internal-rbac.seed-data.js';
import { NotificationsController } from '../../../../src/modules/notifications/notifications.controller.js';
import { NotificationsService } from '../../../../src/modules/notifications/notifications.service.js';

/**
 * Soporte de los smoke tests por TIPO DE USUARIO. Atlas tiene tres vocabularios de identidad que
 * se cruzan y que ningún test cubría de punta a punta:
 *
 *   1. `actorType` del login (`customer` | `internal_user` | `platform_user`) — determina qué claim
 *      de actor viaja en el token (`customerId` / `internalUserId` / `platformUserId`).
 *   2. `AtlasUserRole` — el claim `role`, que es lo que leen `@Roles(...)` y `RolesGuard`.
 *   3. `InternalRoleCode` — los 20 roles RBAC internos, que gobiernan `@InternalPermissions(...)`
 *      vía `InternalPermissionsGuard`.
 *
 * Estos artefactos levantan apps Nest reales (Express + guards reales, sin base de datos) para
 * poder recorrer los tres vocabularios completos por HTTP.
 */

/** Permisos internos usados como sonda: códigos LITERALES del catálogo, sin alias de por medio. */
export const PROBE_PERMISSIONS = {
  me: 'auth.internal.me.read',
  users: 'internal.users.read',
  qa: 'systems.qa.read',
  governance: 'governance.policies.read',
  reporting: 'reporting.read',
  catalog: 'catalog.data.read',
} as const;

export type ProbePermissionKey = keyof typeof PROBE_PERMISSIONS;

/**
 * Controlador sonda con la cadena de guards que usa el grueso del backend
 * (`JwtAuthGuard → TenantGuard → RolesGuard`). Sin lógica de negocio: devuelve el actor resuelto
 * para poder afirmar QUÉ claims sobrevivieron al guard, no solo el status.
 */
@Controller('probe/roles')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
class RoleProbeController {
  /** Sin `@Roles`: cualquier token válido pasa. Sirve para separar 401 (identidad) de 403 (rol). */
  @Get('any')
  any(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('admin-only')
  @Roles('admin', 'platform_admin')
  adminOnly(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('customer-only')
  @Roles('customer')
  customerOnly(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * La lista REAL del cuaderno de datos, sobre el guard REAL.
   *
   * No duplica los roles: importa `DATA_NOTEBOOK_ROLES`, así que la sonda dice lo que dirá el
   * controlador de verdad. Existe porque afirmar «el administrador ya puede entrar» mirando la
   * constante no es lo mismo que verlo pasar por `RolesGuard` con un token emitido como el suyo.
   */
  @Get('data-notebook')
  @Roles(...DATA_NOTEBOOK_ROLES)
  dataNotebook(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

/** Controlador sonda del segundo eje de autorización: permisos RBAC internos. */
@Controller('probe/internal')
@UseGuards(JwtAuthGuard, InternalPermissionsGuard)
class InternalPermissionProbeController {
  @Get('me')
  @InternalPermissions(PROBE_PERMISSIONS.me)
  me(): { ok: true } {
    return { ok: true };
  }

  @Get('users')
  @InternalPermissions(PROBE_PERMISSIONS.users)
  users(): { ok: true } {
    return { ok: true };
  }

  @Get('qa')
  @InternalPermissions(PROBE_PERMISSIONS.qa)
  qa(): { ok: true } {
    return { ok: true };
  }

  @Get('governance')
  @InternalPermissions(PROBE_PERMISSIONS.governance)
  governance(): { ok: true } {
    return { ok: true };
  }

  @Get('reporting')
  @InternalPermissions(PROBE_PERMISSIONS.reporting)
  reporting(): { ok: true } {
    return { ok: true };
  }

  @Get('catalog')
  @InternalPermissions(PROBE_PERMISSIONS.catalog)
  catalog(): { ok: true } {
    return { ok: true };
  }
}

/** `internalUserId` que codifica el rol RBAC del usuario, para que el repositorio falso lo resuelva. */
export function internalUserIdFor(roleCode: InternalRoleCode): string {
  return `iu-${roleCode}`;
}

function roleCodeFromInternalUserId(internalUserId: string): InternalRoleCode | null {
  const code = internalUserId.startsWith('iu-') ? internalUserId.slice(3) : null;
  return code !== null && code in ROLE_PERMISSION_CODES ? (code as InternalRoleCode) : null;
}

/**
 * Repositorio RBAC falso con la MISMA semántica que el real para `hasPermissions`: exige todos los
 * permisos requeridos y los resuelve desde `ROLE_PERMISSION_CODES`, que es la fuente de verdad que
 * el seeder de producción escribe en `internal_role_permissions`. Así el test recorre la matriz
 * real de roles sin necesitar PostgreSQL.
 */
function fakeRbacRepository(): { hasPermissions: (t: string, u: string, p: readonly string[]) => Promise<boolean> } {
  return {
    hasPermissions: async (_tenantId: string, internalUserId: string, requiredPermissions: readonly string[]): Promise<boolean> => {
      const roleCode = roleCodeFromInternalUserId(internalUserId);
      if (!roleCode) return false;
      const granted = new Set(ROLE_PERMISSION_CODES[roleCode]);
      return requiredPermissions.every((permission) => granted.has(permission));
    },
  };
}

export async function buildUserTypesTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [RoleProbeController, InternalPermissionProbeController],
    providers: [
      JwtAuthGuard,
      RolesGuard,
      TenantGuard,
      InternalPermissionsGuard,
      { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
      { provide: InternalRbacRepository, useValue: fakeRbacRepository() },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/** Servicio de notificaciones mockeado: los endpoints de autoservicio solo se usan como sonda de rol. */
export type NotificationsServiceStub = {
  listMyNotifications: jest.Mock;
  myUnreadCount: jest.Mock;
  markMyNotificationRead: jest.Mock;
  markAllMyNotificationsRead: jest.Mock;
};

/**
 * App con el `NotificationsController` REAL. Es el controlador que ya sufrió una regresión de este
 * tipo (su lista de roles de autoservicio omitía `qa_engineer` y `readonly_auditor`), así que sirve
 * de canario: cualquier rol legacy que un usuario interno real pueda tener debe poder leer SU
 * PROPIO inbox.
 */
export async function buildNotificationsSelfServiceApp(): Promise<{ app: INestApplication; service: NotificationsServiceStub }> {
  const service: NotificationsServiceStub = {
    listMyNotifications: jest.fn(async (..._args: unknown[]) => ({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    })),
    myUnreadCount: jest.fn(async (..._args: unknown[]) => ({ unread: 0 })),
    markMyNotificationRead: jest.fn(async (..._args: unknown[]) => ({ id: '1', status: 'read' })),
    markAllMyNotificationsRead: jest.fn(async (..._args: unknown[]) => ({ updated: 0 })),
  } as unknown as NotificationsServiceStub;

  const providers: Provider[] = [
    JwtAuthGuard,
    RolesGuard,
    TenantGuard,
    { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
    { provide: NotificationsService, useValue: service },
  ];

  const moduleRef = await Test.createTestingModule({ controllers: [NotificationsController], providers }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, service };
}

/**
 * Firma un token con la forma REAL de cada tipo de actor (ver `AuthService.issueTokens`):
 * el cliente lleva `customerId` y `tenantId`; el usuario interno, `internalUserId` y `tenantId`;
 * el usuario de plataforma, `platformUserId` y NINGÚN `tenantId` (opera sobre cualquier tenant);
 * el usuario de comercio, `merchantUserId` y `tenantId`.
 */
export function signToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 'e2e-user-types', role, ...overrides },
    env.JWT_ACCESS_TOKEN_SECRET,
    accessTokenSignOptions({ algorithm: 'HS256', expiresIn: '5m' }),
  );
}

export function customerToken(overrides: Record<string, unknown> = {}): string {
  return signToken('customer', { tenantId: '1', customerId: 'cust-1', ...overrides });
}

export function internalToken(role: AtlasUserRole, overrides: Record<string, unknown> = {}): string {
  return signToken(role, { tenantId: '1', internalUserId: 'iu-1', ...overrides });
}

export function platformToken(overrides: Record<string, unknown> = {}): string {
  return signToken('platform_admin', { platformUserId: 'pu-1', ...overrides });
}

/** Cuarta población: el usuario del comercio afiliado (`/merchant/auth/*`). */
export function merchantToken(overrides: Record<string, unknown> = {}): string {
  return signToken('merchant', { tenantId: '1', merchantUserId: 'mu-1', ...overrides });
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
