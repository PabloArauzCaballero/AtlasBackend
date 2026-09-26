/**
 * @file Reaplica las credenciales de desarrollo propias de ESTA máquina tras traer las semillas.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Client } from 'pg';
import { hashPassword } from '../common/utils/crypto/password.util.js';

/**
 * El conjunto sembrado que publica la rama es el MISMO para todos: trae el correo y el hash por
 * defecto del administrador de desarrollo, que es lo que espera CI. Eso vuelve a plantear el
 * problema que `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD` resolvían cuando el seeder se ejecutaba en
 * cada máquina — un desarrollador necesita apuntar la cuenta a un buzón real para RECIBIR el PIN
 * del segundo factor, y no puede hacerlo reescribiendo un archivo versionado (ATLAS-P0-002: un
 * hash que entra al historial de git se considera comprometido para siempre).
 *
 * La respuesta es la misma de antes, movida después de la copia: si las variables están en `.env`
 * —que no se versiona—, se aplican aquí sobre las filas ya traídas, y la contraseña se hashea EN
 * ESTA máquina. Sin variables no se toca nada y la base queda exactamente como la rama.
 *
 * Sólo corre fuera de producción: en producción no existe "el administrador de desarrollo".
 */

/** Identificadores fijados por la semilla del administrador de desarrollo. */
const DEV_ADMIN_INTERNAL_USER_ID = 1;

export interface LocalIdentityOverrides {
  readonly adminEmail?: string | undefined;
  readonly adminPassword?: string | undefined;
  readonly partnerPassword?: string | undefined;
}

export interface LocalIdentityResult {
  readonly applied: string[];
}

export async function applyLocalIdentityOverrides(target: Client, overrides: LocalIdentityOverrides): Promise<LocalIdentityResult> {
  const applied: string[] = [];

  if (overrides.adminEmail) {
    await target.query('UPDATE iam.internal_users SET email = $1, _updated_at = now() WHERE _id = $2', [
      overrides.adminEmail,
      DEV_ADMIN_INTERNAL_USER_ID,
    ]);
    applied.push('DEV_ADMIN_EMAIL');
  }

  if (overrides.adminPassword) {
    const passwordHash = await hashPassword(overrides.adminPassword);
    // `token_version + 1` invalida las sesiones emitidas con la contraseña anterior, igual que
    // hacía el seeder: cambiar la clave sin revocar lo ya emitido no es cambiar la clave.
    await target.query(
      `UPDATE iam.auth_credentials
          SET password_hash = $1, token_version = token_version + 1, failed_login_attempts = 0,
              locked_until = NULL, _updated_at = now()
        WHERE actor_type = 'internal_user' AND actor_id = $2`,
      [passwordHash, DEV_ADMIN_INTERNAL_USER_ID],
    );
    applied.push('DEV_ADMIN_PASSWORD');
  }

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

  return { applied };
}
