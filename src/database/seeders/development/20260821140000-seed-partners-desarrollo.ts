/**
 * @file Seeder de desarrollo: las dos identidades de comercio (partner) con las que se puede entrar al portal.
 * @business Sin un partner que pueda iniciar sesión, el portal del comercio no es recorrible en local.
 * @system define development para que el acceso del comercio exista en una máquina nueva.
 */
import { QueryInterface, Transaction } from 'sequelize';
import { env } from '../../../config/env.js';
import { hashPassword } from '../../../common/utils/crypto/password.util.js';

/**
 * Identidades de COMERCIO (población `merchant_user`) para desarrollo, con su expediente de partner.
 *
 * ## Por qué existe
 *
 * `iam.merchant_users` es la cuarta población autenticable y la única que puede entrar por
 * `POST /auth/merchant/login`, que es lo que usa la pestaña «Comercio afiliado» del ERP. En una base
 * recién sembrada esa tabla queda VACÍA: el perfil `development` sólo creaba el SUPER_ADMIN interno
 * (`20260704121500-seed-pablo-admin-user`), y las fixtures del portal que sí traen comercios viven en
 * el ERP —`atlas_sales.merchant_users`, que es MEMBRESÍA, no identidad— y no llevan contraseña.
 *
 * El resultado medible: media plataforma —el portal del comercio y todo el onboarding de partner— no
 * se podía abrir en local, no porque estuviera rota sino porque no había con quién entrar.
 *
 * ## Qué siembra
 *
 * Dos identidades activas con contraseña, y un expediente `partner.partner_profiles` por cada una,
 * ya aprobado y con `owner_merchant_user_id` apuntando a su dueño. Lo segundo no es adorno: sin
 * dueño, `assertOwnPartnerResource` trata el expediente como accesible sólo para roles internos, así
 * que un partner sin expediente propio entra al portal y no puede tocar nada suyo.
 *
 * ## Identificadores fijos
 *
 * `_id` 9001 y 9002, explícitos en vez de autoincrementales, porque la MEMBRESÍA vive en otra base:
 * `atlas_sales.merchant_users.user_id` (ERP) guarda como texto el `sub` del token, que es este `_id`.
 * Con ids autogenerados el seeder del ERP no tendría a qué apuntar sin consultar esta base. El rango
 * 9000 está deliberadamente lejos de la secuencia, y el `setval` de abajo evita que un alta posterior
 * choque contra ellos.
 *
 * ## ATLAS-P0-001 / P0-002
 *
 * Seeder de PERFIL DEVELOPMENT: jamás debe correr en producción —crearía cuentas con una contraseña
 * conocida por cualquiera con acceso al repo—. El runner por perfiles ya bloquea `development` bajo
 * `NODE_ENV=production`; el guard de `up()` es defensa en profundidad, igual que en el seeder de
 * Pablo.
 *
 * La contraseña por defecto está EN CLARO en este archivo, a petición explícita, para que estas dos
 * cuentas funcionen en cualquier máquina sin configurar nada. Es la misma excepción que el hash
 * versionado del seeder interno y arrastra la misma consecuencia: cualquiera con acceso de lectura al
 * repositorio la conoce, de forma permanente, y por eso no puede reutilizarse en ningún entorno real.
 * `DEV_PARTNER_PASSWORD` en `.env` (que no se versiona) la sustituye cuando eso importe.
 */

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const TENANT_ID = 1;

/** Contraseña de desarrollo. Ver la nota ATLAS-P0-002 de arriba antes de tocar esto. */
const DEFAULT_PARTNER_PASSWORD = '72107014Casa_';

interface PartnerSeed {
  merchantUserId: number;
  userCode: string;
  email: string;
  fullName: string;
  legalName: string;
  tradeName: string;
  taxId: string;
  businessCategory: string;
  city: string;
}

const PARTNERS: readonly PartnerSeed[] = [
  {
    merchantUserId: 9001,
    userCode: 'partner.cpa',
    email: 'cpacentropreparacionacademica@gmail.com',
    fullName: 'CPA Centro Preparacion Academica',
    legalName: 'Centro de Preparacion Academica CPA SRL',
    tradeName: 'CPA Centro Preparacion Academica',
    taxId: 'DEV-PARTNER-CPA-001',
    businessCategory: 'EDUCATION',
    city: 'Santa Cruz de la Sierra',
  },
  {
    merchantUserId: 9002,
    userCode: 'partner.pabliarca',
    email: 'pabliarca@gmail.com',
    fullName: 'Pablo Arauz Caballero',
    legalName: 'Pabliarca Comercio SRL',
    tradeName: 'Pabliarca',
    taxId: 'DEV-PARTNER-PABLIARCA-002',
    businessCategory: 'RETAIL',
    city: 'Santa Cruz de la Sierra',
  },
];

/**
 * La contraseña se hashea AL SEMBRAR y nunca se guarda ya hasheada en el repositorio: un hash que
 * entra al historial de git se considera comprometido para siempre (ATLAS-P0-002), y eso vale igual
 * para el hash que para la contraseña.
 */
function partnerPassword(): string {
  return env.DEV_PARTNER_PASSWORD ?? DEFAULT_PARTNER_PASSWORD;
}

type QueryParams = {
  sql: string;
  replacements?: Record<string, unknown>;
  transaction: Transaction;
};

async function runQuery(queryInterface: QueryInterface, input: QueryParams): Promise<void> {
  await queryInterface.sequelize.query(input.sql, { replacements: input.replacements, transaction: input.transaction });
}

/**
 * `must_change_password = false` y `status = 'active'` a propósito: la tabla nace con el usuario
 * `invited` y obligado a cambiar la contraseña, que es lo correcto para un alta real pero convierte
 * una cuenta de desarrollo en dos pasos antes de poder mirar nada.
 */
async function upsertPartnerIdentity(queryInterface: QueryInterface, transaction: Transaction, partner: PartnerSeed): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO iam.merchant_users (
        _id, _tenant_id, user_code, full_name, email, role_code, status, phone,
        last_login_at, password_changed_at, must_change_password, mfa_enabled,
        created_by_internal_user_id, updated_by_internal_user_id, _created_at, _updated_at, _deleted
      )
      VALUES (
        :id, :tenantId, :userCode, :fullName, :email, 'merchant', 'active', NULL,
        NULL, :createdAt, false, false, NULL, NULL, :createdAt, :createdAt, false
      )
      ON CONFLICT (_id)
      DO UPDATE SET
        _tenant_id = EXCLUDED._tenant_id,
        user_code = EXCLUDED.user_code,
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        role_code = EXCLUDED.role_code,
        status = EXCLUDED.status,
        password_changed_at = EXCLUDED.password_changed_at,
        must_change_password = EXCLUDED.must_change_password,
        mfa_enabled = EXCLUDED.mfa_enabled,
        _updated_at = EXCLUDED._updated_at,
        _deleted = false;
    `,
    replacements: {
      id: partner.merchantUserId,
      tenantId: TENANT_ID,
      userCode: partner.userCode,
      fullName: partner.fullName,
      email: partner.email,
      createdAt: CREATED_AT,
    },
  });
}

/**
 * Credenciales en `auth_credentials`, que es común a las cuatro poblaciones y se distingue por
 * `actor_type`. Primero se actualiza la existente y después se inserta si no había: al revés, un
 * reseed dejaría la contraseña vieja en pie sin que nada lo dijera.
 *
 * `token_version + 1` invalida las sesiones anteriores de esa cuenta, que es lo que debe pasar cuando
 * a alguien se le cambia la contraseña por debajo.
 */
async function upsertPartnerCredentials(
  queryInterface: QueryInterface,
  transaction: Transaction,
  partner: PartnerSeed,
  passwordHash: string,
): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      UPDATE iam.auth_credentials
      SET password_hash = :passwordHash,
          token_version = token_version + 1,
          failed_login_attempts = 0,
          locked_until = NULL,
          _updated_at = :createdAt,
          _deleted = false
      WHERE actor_type = 'merchant_user' AND actor_id = :actorId;
    `,
    replacements: { passwordHash, actorId: partner.merchantUserId, createdAt: CREATED_AT },
  });

  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO iam.auth_credentials (
        _tenant_id, actor_type, actor_id, password_hash, token_version, failed_login_attempts,
        locked_until, last_login_at, last_login_ip, _created_at, _updated_at, _deleted
      )
      SELECT :tenantId, 'merchant_user', :actorId, :passwordHash, 1, 0, NULL, NULL, NULL, :createdAt, :createdAt, false
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.auth_credentials WHERE actor_type = 'merchant_user' AND actor_id = :actorId AND _deleted = false
      );
    `,
    replacements: { tenantId: TENANT_ID, actorId: partner.merchantUserId, passwordHash, createdAt: CREATED_AT },
  });
}

/**
 * El expediente de partner, aprobado y con dueño.
 *
 * La clave natural es `(_tenant_id, tax_id)` —el índice único de la tabla—, no el `_id`: dos
 * expedientes del mismo NIT son el mismo negocio. Se siembra `approved` y con los contactos ya
 * verificados porque el objetivo es tener un partner OPERATIVO en local; el camino de verificación
 * real se ejercita creando un expediente nuevo, no reabriendo éste.
 */
async function upsertPartnerProfile(queryInterface: QueryInterface, transaction: Transaction, partner: PartnerSeed): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO partner.partner_profiles (
        _tenant_id, legal_name, trade_name, tax_id, commercial_registry, business_category,
        contact_email, contact_phone, email_verified_at, phone_verified_at, contact_code_attempts,
        onboarding_status, submitted_at, decided_at, decided_by_internal_user_id,
        owner_merchant_user_id, rejection_reason, erp_account_id, _created_at, _updated_at, _deleted
      )
      VALUES (
        :tenantId, :legalName, :tradeName, :taxId, NULL, :businessCategory,
        :contactEmail, NULL, :createdAt, NULL, 0,
        'approved', :createdAt, :createdAt, NULL,
        :ownerId, NULL, NULL, :createdAt, :createdAt, false
      )
      ON CONFLICT (_tenant_id, tax_id) WHERE _deleted = false
      DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        trade_name = EXCLUDED.trade_name,
        business_category = EXCLUDED.business_category,
        contact_email = EXCLUDED.contact_email,
        email_verified_at = EXCLUDED.email_verified_at,
        onboarding_status = EXCLUDED.onboarding_status,
        owner_merchant_user_id = EXCLUDED.owner_merchant_user_id,
        _updated_at = EXCLUDED._updated_at,
        _deleted = false;
    `,
    replacements: {
      tenantId: TENANT_ID,
      legalName: partner.legalName,
      tradeName: partner.tradeName,
      taxId: partner.taxId,
      businessCategory: partner.businessCategory,
      contactEmail: partner.email,
      ownerId: partner.merchantUserId,
      createdAt: CREATED_AT,
    },
  });
}

/**
 * Los `_id` sembrados a mano no avanzan la secuencia: sin esto, el primer alta real de un comercio
 * intentaría el `_id` 1 y, cuando la secuencia llegara a 9001, chocaría contra estas filas.
 */
async function realignSequence(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      SELECT setval(
        pg_get_serial_sequence('iam.merchant_users', '_id'),
        COALESCE((SELECT MAX(_id) FROM iam.merchant_users), 1),
        true
      )
      WHERE pg_get_serial_sequence('iam.merchant_users', '_id') IS NOT NULL;
    `,
  });
}

async function createSeedAudit(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  await runQuery(queryInterface, {
    transaction,
    sql: `
      INSERT INTO audit.operational_audit_logs (
        _tenant_id, actor_type, actor_internal_user_id, actor_platform_user_id, action_code,
        target_type, target_id, ip_address, user_agent, payload_json, occurred_at, _created_at
      )
      VALUES (
        :tenantId, 'system', NULL, NULL, 'seed.partners_desarrollo.applied',
        'database_seed', '20260821140000-seed-partners-desarrollo', '127.0.0.1', 'Atlas Seeder',
        CAST(:payload AS jsonb), :createdAt, :createdAt
      );
    `,
    replacements: {
      tenantId: TENANT_ID,
      payload: JSON.stringify({
        partners: PARTNERS.map((partner) => ({ id: partner.merchantUserId, email: partner.email })),
        note: 'Identidades de comercio de desarrollo para el login del portal y el onboarding de partner.',
      }),
      createdAt: CREATED_AT,
    },
  });
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'El seeder development/20260821140000-seed-partners-desarrollo.ts no puede ejecutarse con ' +
        'NODE_ENV=production: crearía identidades de comercio con una contraseña versionada en git. ' +
        'Un partner real se da de alta por su propio onboarding, no por este seeder.',
    );
  }

  const passwordHash = await hashPassword(partnerPassword());

  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const partner of PARTNERS) {
      await upsertPartnerIdentity(queryInterface, transaction, partner);
      await upsertPartnerCredentials(queryInterface, transaction, partner, passwordHash);
      await upsertPartnerProfile(queryInterface, transaction, partner);
    }
    await realignSequence(queryInterface, transaction);
    await createSeedAudit(queryInterface, transaction);
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Se marcan como borradas en vez de eliminarse: el expediente y las credenciales cuelgan de
    // estas identidades, y un DELETE dejaría filas huérfanas en tablas de otro esquema.
    await runQuery(queryInterface, {
      transaction,
      sql: `
        UPDATE iam.merchant_users
        SET status = 'disabled', _deleted = true, _updated_at = :updatedAt
        WHERE _id IN (:ids);
      `,
      replacements: { ids: PARTNERS.map((partner) => partner.merchantUserId), updatedAt: new Date() },
    });
    await runQuery(queryInterface, {
      transaction,
      sql: `
        UPDATE iam.auth_credentials
        SET _deleted = true, _updated_at = :updatedAt
        WHERE actor_type = 'merchant_user' AND actor_id IN (:ids);
      `,
      replacements: { ids: PARTNERS.map((partner) => partner.merchantUserId), updatedAt: new Date() },
    });
  });
}
