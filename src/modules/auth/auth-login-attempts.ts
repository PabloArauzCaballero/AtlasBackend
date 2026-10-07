/**
 * @file Utilidad de persistencia: arma el UPDATE atómico que reserva un intento de login.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Op, literal } from 'sequelize';

export type LoginAttemptLimits = { maxAttempts: number; lockoutMinutes: number };

/**
 * Valores y condición del UPDATE que reserva un intento ANTES de verificar el secreto.
 *
 * Va en SQL (`x = x + 1`) y no sobre la instancia leída: N logins concurrentes suman N —antes todos
 * leían k y escribían k+1— y, con el bloqueo puesto, la condición no casa y ninguno más llega a
 * argon2. El intento que alcanza el máximo fija el bloqueo, reinicia el contador y es el último que
 * se evalúa. Vive aparte porque `auth.repository.ts` tiene el tamaño congelado.
 */
export function loginAttemptReservation(credentialId: string, limits: LoginAttemptLimits, now = new Date()): [never, { where: never }] {
  const lockUntil = new Date(now.getTime() + limits.lockoutMinutes * 60_000).toISOString();
  const reachesMax = `"failed_login_attempts" + 1 >= ${Number(limits.maxAttempts)}`;
  const values = {
    failedLoginAttempts: literal(`CASE WHEN ${reachesMax} THEN 0 ELSE "failed_login_attempts" + 1 END`),
    lockedUntil: literal(`CASE WHEN ${reachesMax} THEN '${lockUntil}'::timestamptz ELSE NULL END`),
    updatedAtValue: now,
  };
  const where = { id: credentialId, [Op.or]: [{ lockedUntil: null }, { lockedUntil: { [Op.lte]: now } }] };
  return [values as never, { where: where as never }];
}
