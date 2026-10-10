/**
 * @file Reaplica las credenciales de desarrollo propias de ESTA máquina tras traer las semillas.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { hashPassword, isPasswordStrongEnough } from '../common/utils/crypto/password.util.js';

/**
 * El conjunto sembrado que publica la rama es el MISMO para todos y trae al administrador de
 * desarrollo (`iam.internal_users._id = 1`) con el correo y el hash que tuviera la máquina que lo
 * publicó. Ninguno de los dos puede quedarse así:
 *
 * - **Correo.** Se fija SIEMPRE: `DEV_ADMIN_EMAIL` si está en `.env`, y si no
 *   `DEFAULT_DEV_ADMIN_EMAIL` (`admin@atlas.local`), un dominio reservado que no es de nadie. Antes
 *   el defecto era una cuenta personal, y quedaba documentada en el repo público.
 * - **Contraseña.** Se fija SIEMPRE, porque un hash que viaja en un conjunto compartido es un hash
 *   conocido (ATLAS-P0-002: lo que entra al historial se da por comprometido para siempre; la
 *   contraseña de la cuenta anterior está filtrada). `DEV_ADMIN_PASSWORD` si está en `.env`; si no,
 *   se genera una aleatoria EN ESTA máquina y se devuelve para que el llamador la imprima UNA vez.
 *   No se guarda en ninguna parte: si se pierde, se vuelve a traer la semilla o se define la
 *   variable.
 *
 * La contraseña se hashea aquí, nunca sale del proceso, y cambiarla sube `token_version`.
 *
 * Sólo corre fuera de producción y sólo justo después de una carga real (los llamadores no la
 * invocan cuando `--if-empty` se salta la siembra): en producción no existe "el administrador de
 * desarrollo", y en una base ya sembrada no se toca nada.
 */

/** Identificadores fijados por la semilla del administrador de desarrollo. */
const DEV_ADMIN_INTERNAL_USER_ID = 1;

/** Correo del administrador de desarrollo cuando `.env` no trae `DEV_ADMIN_EMAIL`. */
export const DEFAULT_DEV_ADMIN_EMAIL = 'admin@atlas.local';

export interface LocalIdentityOverrides {
  readonly adminEmail?: string | undefined;
  readonly adminPassword?: string | undefined;
  readonly partnerPassword?: string | undefined;
}

export interface LocalIdentityResult {
  readonly applied: string[];
  /** Sólo cuando NO había `DEV_ADMIN_PASSWORD`: la contraseña aleatoria recién puesta, para mostrarla una vez. */
  readonly generatedAdminPassword?: string;
  readonly adminEmail: string;
}

/** 24 caracteres base64url (144 bits) que además cumplen la regla de contraseñas internas. */
export function generateDevAdminPassword(): string {
  let candidate: string;
  do {
    candidate = randomBytes(18).toString('base64url');
  } while (!isPasswordStrongEnough(candidate));
  return candidate;
}

export async function applyLocalIdentityOverrides(target: Client, overrides: LocalIdentityOverrides): Promise<LocalIdentityResult> {
  const applied: string[] = [];

  const ownEmail = overrides.adminEmail?.trim();
  const adminEmail = ownEmail ? ownEmail : DEFAULT_DEV_ADMIN_EMAIL;
  await target.query('UPDATE iam.internal_users SET email = $1, _updated_at = now() WHERE _id = $2', [
    adminEmail,
    DEV_ADMIN_INTERNAL_USER_ID,
  ]);
  applied.push(ownEmail ? 'DEV_ADMIN_EMAIL' : 'DEV_ADMIN_EMAIL(por defecto)');

  const ownPassword = overrides.adminPassword ? overrides.adminPassword : null;
  const adminPassword = ownPassword ?? generateDevAdminPassword();
  const adminHash = await hashPassword(adminPassword);
  // `token_version + 1` invalida las sesiones emitidas con la contraseña anterior, igual que
  // hacía el seeder: cambiar la clave sin revocar lo ya emitido no es cambiar la clave.
  await target.query(
    `UPDATE iam.auth_credentials
        SET password_hash = $1, token_version = token_version + 1, failed_login_attempts = 0,
            locked_until = NULL, _updated_at = now()
      WHERE actor_type = 'internal_user' AND actor_id = $2`,
    [adminHash, DEV_ADMIN_INTERNAL_USER_ID],
  );
  applied.push(ownPassword ? 'DEV_ADMIN_PASSWORD' : 'DEV_ADMIN_PASSWORD(aleatoria)');

  if (overrides.partnerPassword) {
    const passwordHash = await hashPassword(overrides.partnerPassword);
    await target.query(
      `UPDATE iam.auth_credentials
          SET password_hash = $1, token_version = token_version + 1, failed_login_attempts = 0,
              locked_until = NULL, _updated_at = now()
        WHERE actor_type = 'merchant_user'`,
      [passwordHash],
    );
    applied.push('DEV_PARTNER_PASSWORD');
  }

  return ownPassword ? { applied, adminEmail } : { applied, adminEmail, generatedAdminPassword: adminPassword };
}
