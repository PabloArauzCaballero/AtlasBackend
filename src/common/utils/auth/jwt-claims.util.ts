/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza protege el acceso de clientes y operadores.
 * @system centraliza los claims con los que se firma y se verifica el token de acceso.
 */
import type { SignOptions, VerifyOptions } from 'jsonwebtoken';
import { env } from '../../../config/env.js';

/**
 * Claims `iss`/`aud` del token de acceso, en un solo sitio.
 *
 * Hallazgo A-08 de `docs/audit/auditoria-integral-2026-07-30.md`: el token se firmaba y verificaba
 * con `algorithms: ['HS256']` (bien) pero SIN emisor ni audiencia. El mismo
 * `JWT_ACCESS_TOKEN_SECRET` lo usa también `systems-health.service.ts` para firmar un token de
 * sonda: hoy no es explotable (ese payload no pasa `parseAuthenticatedUser`), pero sin `iss`/`aud`
 * cualquier futuro token firmado con ese secreto para otro propósito es un token de sesión en
 * potencia. Con estos claims, un token solo vale para el emisor y la audiencia declarados.
 *
 * Firmar y verificar viven juntos a propósito: separados, es cuestión de tiempo que alguien cambie
 * uno y no el otro, y el síntoma sería "todos los usuarios deslogueados" en producción.
 *
 * EFECTO AL DESPLEGAR: los tokens de acceso emitidos ANTES de este cambio no llevan `iss`/`aud` y se
 * rechazan. Es una ventana de como mucho `JWT_ACCESS_TOKEN_EXPIRES_IN` (1 h por defecto) y se cura
 * sola: los refresh tokens son opacos y no se ven afectados, así que los clientes renuevan y siguen.
 */
export function accessTokenSignOptions(base: SignOptions): SignOptions {
  return { ...base, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE };
}

/**
 * El tipo de retorno fija `complete?: false` a propósito: `jwt.verify` elige su sobrecarga según
 * ese campo, y con un `VerifyOptions` genérico devolvería `Jwt | JwtPayload | string`, obligando a
 * los llamantes a estrechar un caso que este proyecto nunca usa.
 */
export function accessTokenVerifyOptions(base: VerifyOptions = {}): VerifyOptions & { complete?: false } {
  return { ...base, complete: false, algorithms: ['HS256'], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE };
}

/**
 * Claim con el id del actor según su población. Estaba escrito como cuatro ternarios repetidos
 * dentro del emisor de tokens: una lista disfrazada de condicionales, que obligaba a tocar un
 * archivo con deuda de tamaño congelada cada vez que aparece una población nueva.
 *
 * El claim redundante con `sub` existe porque el guard resuelve la población a partir de él para
 * comprobar `tokenVersion` contra la tabla correcta.
 */
const ACTOR_ID_CLAIM: Readonly<Record<string, string>> = {
  customer: 'customerId',
  internal_user: 'internalUserId',
  platform_user: 'platformUserId',
  merchant_user: 'merchantUserId',
};

export function actorIdClaim(actorType: string, actorId: string): Record<string, string> {
  const claim = ACTOR_ID_CLAIM[actorType];
  return claim ? { [claim]: actorId } : {};
}
