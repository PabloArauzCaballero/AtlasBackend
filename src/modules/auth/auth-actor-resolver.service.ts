import { Injectable } from '@nestjs/common';
import { AtlasUserRole } from '../../common/types/auth.types.js';
import { hashSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { ActorType, AuthRepository } from './auth.repository.js';

/** Actor autenticable ya resuelto (cliente, usuario interno o de plataforma), con su rol vigente. */
export type ResolvedActor = {
  id: string;
  tenantId: string | null;
  role: AtlasUserRole;
  /** Email de contacto para correos transaccionales (para actores internos, el mismo email de login). */
  email: string | null;
  displayName: string | null;
};

const KNOWN_ROLES: ReadonlySet<AtlasUserRole> = new Set([
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'merchant',
  'admin',
  'platform_admin',
]);

export function isKnownRole(value: string): value is AtlasUserRole {
  return KNOWN_ROLES.has(value as AtlasUserRole);
}

/**
 * Resuelve el actor autenticable a partir de un identificador (login) o de su id (re-resolución en
 * refresh/PIN), unificando las tres fuentes: clientes, usuarios internos y usuarios de plataforma.
 * Extraído de `AuthService` (Fase 2.2 del plan 10/10) por ser una responsabilidad cohesiva y
 * compartida por login, verificación de PIN, reset de contraseña y rotación de refresh token.
 */
@Injectable()
export class AuthActorResolverService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  /** Resuelve el actor durante el login, a partir del identificador que el usuario escribió. */
  async resolveActorForLogin(tenantId: string, actorType: ActorType, identifier: string): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const identifierHash = hashSensitiveText(identifier);
      const customer = await this.customersRepository.findByContactHash(tenantId, {
        phoneHash: identifierHash,
        emailHash: identifierHash,
      });
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      // El email/teléfono del cliente se almacena hasheado; el único valor en claro disponible
      // es el identificador que el propio cliente acaba de escribir (y que coincidió por hash).
      const email = identifier.includes('@') ? identifier : null;
      return { id: customer.id, tenantId: customer.tenantId, role: 'customer', email, displayName: null };
    }

    if (actorType === 'internal_user') {
      // La búsqueda normaliza email en el repositorio para tolerar diferencias de mayúsculas.
      const internalUser = await this.authRepository.findInternalUserByEmail(identifier, tenantId);
      if (!internalUser || internalUser.status !== 'active' || !internalUser.roleCode || !isKnownRole(internalUser.roleCode)) {
        return null;
      }
      return {
        id: internalUser.id,
        tenantId: internalUser.tenantId,
        role: internalUser.roleCode,
        email: internalUser.email,
        displayName: internalUser.fullName,
      };
    }

    // platform_user
    const platformUser = await this.authRepository.findPlatformUserByEmail(identifier);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) {
      return null;
    }
    return {
      id: platformUser.id,
      tenantId: null,
      role: platformUser.roleCode,
      email: platformUser.email,
      displayName: platformUser.fullName,
    };
  }

  /** Re-resuelve el rol/tenant vigentes de un actor ya conocido por su id (refresh y verificación de PIN). */
  async reResolveActorRole(actorType: ActorType, actorId: string, tenantId: string | null): Promise<ResolvedActor | null> {
    if (actorType === 'customer') {
      const customer = tenantId ? await this.customersRepository.findById(tenantId, actorId) : null;
      if (!customer || customer.lifecycleStatus === 'closed') return null;
      return { id: actorId, tenantId, role: 'customer', email: null, displayName: null };
    }
    if (actorType === 'internal_user') {
      const internalUser = await this.authRepository.findInternalUserById(actorId);
      if (!internalUser || internalUser.status !== 'active' || !internalUser.roleCode || !isKnownRole(internalUser.roleCode)) return null;
      return {
        id: actorId,
        tenantId: internalUser.tenantId,
        role: internalUser.roleCode,
        email: internalUser.email,
        displayName: internalUser.fullName,
      };
    }
    const platformUser = await this.authRepository.findPlatformUserById(actorId);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) return null;
    return { id: actorId, tenantId: null, role: platformUser.roleCode, email: platformUser.email, displayName: platformUser.fullName };
  }
}
