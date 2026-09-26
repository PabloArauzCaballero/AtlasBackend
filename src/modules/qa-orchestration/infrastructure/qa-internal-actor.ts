/**
 * @file Adaptador de infraestructura: inicio de sesión del operador interno QA provisionado.
 * @business Esta pieza da a los pasos del operador (revisión, decisión, aprobación) una sesión
 *   propia con el rol mínimo, en vez de la de quien lanzó la corrida.
 * @system `POST /internal/auth/login`; la sesión interna viaja en cookie y el backend también la
 *   acepta como Bearer. Nunca se salta el segundo factor: si el entorno lo exige, no hay actor.
 */

export type InternalActorSession = { ok: true; accessToken: string } | { ok: false; message: string };

function cookieValue(setCookie: string[], name: string): string | null {
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const [key, ...rest] = pair.split('=');
    if (key.trim() === name) return rest.join('=');
  }
  return null;
}

export async function loginInternalActor(input: {
  baseUrl: string;
  tenantId: string;
  email: string;
  password: string;
  timeoutMs?: number;
}): Promise<InternalActorSession> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/, '')}/internal/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': input.tenantId },
      body: JSON.stringify({ email: input.email, password: input.password }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as { data?: { pinChallengeRequired?: boolean; accessToken?: string } } | null;
    if (body?.data?.pinChallengeRequired) {
      return {
        ok: false,
        message: 'El operador interno QA exige PIN por correo y este entorno no tiene buzón QA: no se salta el segundo factor.',
      };
    }
    const token = body?.data?.accessToken ?? cookieValue(response.headers.getSetCookie?.() ?? [], 'atlas_internal_access');
    if (response.status >= 300 || !token)
      return { ok: false, message: `El operador interno QA no pudo iniciar sesión (HTTP ${response.status}).` };
    return { ok: true, accessToken: token };
  } catch (error) {
    return { ok: false, message: `El operador interno QA no pudo iniciar sesión: ${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
