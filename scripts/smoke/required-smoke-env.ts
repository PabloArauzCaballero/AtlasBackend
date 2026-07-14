/**
 * Los smoke tests que autentican de verdad (login real contra la API) no deben tener una
 * contraseña de repuesto embebida en el script — un valor "solo para desarrollo" en un archivo
 * versionado es indistinguible, en la práctica, de una credencial de producción filtrada
 * (ver ATLAS-P0-SEC-001). Cada smoke que necesite una de estas variables debe fallar con un
 * mensaje claro en vez de autenticarse silenciosamente con un valor conocido.
 */
export function requireSmokeEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} es obligatorio para este smoke test (no tiene valor por defecto). Exporta la variable antes de ejecutarlo.`);
  }
  return value;
}
