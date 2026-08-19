/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { ATLAS_USER_ROLES, AtlasUserRole } from '../../common/types/auth.types.js';
import { decryptSecretEnvelope } from '../../common/utils/crypto/envelope-encryption.util.js';
import { hashSensitiveText } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomerContactsRepository } from '../customers/repositories/customer-contacts.repository.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { MerchantActorRepository } from './merchant-actor.repository.js';

/** Actor autenticable ya resuelto (cliente, usuario interno o de plataforma), con su rol vigente. */
export type ResolvedActor = {
  id: string;
  tenantId: string | null;
  role: AtlasUserRole;
  /** Email de contacto para correos transaccionales (para actores internos, el mismo email de login). */
  email: string | null;
  displayName: string | null;
};

// Mismo vocabulario que acepta `JwtAuthGuard`: ambos derivan de `ATLAS_USER_ROLES` para que
// "rol con el que se puede iniciar sesión" y "rol que el guard acepta en el token" no diverjan.
const KNOWN_ROLES: ReadonlySet<AtlasUserRole> = new Set(ATLAS_USER_ROLES);

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
    private readonly customerContactsRepository: CustomerContactsRepository,
    private readonly merchantActorRepository: MerchantActorRepository,
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
      // El email/teléfono del cliente se almacena hasheado. Si el identificador escrito ES un
      // email, ese valor en claro sirve directamente. Si el cliente entró con su TELÉFONO, antes se
      // devolvía `email: null` y la recuperación de contraseña quedaba silenciosamente muerta,
      // aunque el cliente tuviera un correo registrado y verificado. Ahora se recupera de
      // `customer_contact_methods` descifrando el sobre.
      const email = identifier.includes('@') ? identifier : await this.resolveCustomerEmail(tenantId, String(customer.id));
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

    if (actorType === 'merchant_user') {
      return this.resolveMerchantActor(await this.merchantActorRepository.findMerchantUserByEmail(identifier, tenantId));
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

  /**
   * Identidad del comercio afiliado, con la misma comprobación en el login y en el refresh.
   *
   * Fail-closed en tres puntos: identidad inexistente, estado distinto de `active`, o rol fuera del
   * vocabulario que acepta el guard. Una identidad `invited` todavía no ha aceptado su alta; una
   * `suspended` es exactamente el caso que el portal del comercio tiene que impedir sin depender de
   * que el ERP se acuerde de comprobarlo.
   */
  private resolveMerchantActor(
    merchantUser: {
      id: string;
      tenantId: string;
      roleCode: string;
      email: string;
      fullName: string | null;
      status: string;
    } | null,
  ): ResolvedActor | null {
    if (!merchantUser || merchantUser.status !== 'active' || !isKnownRole(merchantUser.roleCode)) return null;
    return {
      id: merchantUser.id,
      tenantId: merchantUser.tenantId,
      role: merchantUser.roleCode,
      email: merchantUser.email,
      displayName: merchantUser.fullName,
    };
  }

  /**
   * Correo de contacto del cliente para mensajes transaccionales.
   *
   * Prefiere un correo ya verificado; si no hay ninguno verificado, acepta uno declarado. Un fallo
   * de descifrado no puede tumbar el login ni revelar la existencia de la cuenta: se degrada a
   * `null`, que el llamador trata como "no hay canal disponible".
   */
  private async resolveCustomerEmail(tenantId: string, customerId: string): Promise<string | null> {
    const contacts = await this.customerContactsRepository.findContactMethods(tenantId, customerId);
    const emails = contacts.filter((contact) => contact.contactType === 'email' && contact.contactValueEncrypted !== null);
    const preferred = emails.find((contact) => contact.status === 'verified') ?? emails[0];
    if (!preferred) return null;
    try {
      return await decryptSecretEnvelope(preferred.contactValueEncrypted);
    } catch {
      // Sobre ilegible (rotación de clave incompleta, dato corrupto): sin canal, sin filtración.
      return null;
    }
  }

  /**
   * Igual que `reResolveActorRole`, pero con el correo resuelto también para `customer`.
   *
   * `reResolveActorRole` devuelve `email: null` para un cliente porque sus consumidores —refresh y
   * verificación de PIN— no envían nada: el correo del cliente está cifrado en `customer_contacts`
   * y descifrarlo en cada rotación de token sería trabajo puro y duro sin destinatario. Quien SÍ
   * necesita el canal —el cambio de contraseña— lo pide por aquí y paga ese descifrado una vez.
   *
   * Sin esto, un cliente autenticado veía "no hay canal para entregar el código" con un correo
   * verificado en su ficha.
   */
  async reResolveActorWithEmail(actorType: ActorType, actorId: string, tenantId: string | null): Promise<ResolvedActor | null> {
    const actor = await this.reResolveActorRole(actorType, actorId, tenantId);
    if (!actor || actor.email || actorType !== 'customer' || !tenantId) return actor;
    return { ...actor, email: await this.resolveCustomerEmail(tenantId, actorId) };
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
    if (actorType === 'merchant_user') {
      // El refresh vuelve a leer el estado: suspender a un usuario del comercio corta su sesión en
      // la siguiente rotación, sin esperar a que caduque el access token.
      return this.resolveMerchantActor(await this.merchantActorRepository.findMerchantUserById(actorId));
    }

    const platformUser = await this.authRepository.findPlatformUserById(actorId);
    if (!platformUser || platformUser.status !== 'active' || !platformUser.roleCode || !isKnownRole(platformUser.roleCode)) return null;
    return { id: actorId, tenantId: null, role: platformUser.roleCode, email: platformUser.email, displayName: platformUser.fullName };
  }
}
