/**
 * Validación fail-fast de configuración de proveedores "enchufables" (notificaciones, datos
 * externos, cualquier adaptador nuevo). Antes de este mecanismo, un proveedor mal configurado
 * (falta una API key, falta una URL) recién se descubría en la PRIMERA request real en
 * producción — con este validador, falta en el boot del proceso.
 *
 * Uso: cada módulo de adaptadores declara su propio mapa `{ providerValue: requiredEnvVars[] }`
 * y llama `assertProviderConfigured` una vez al arrancar (`onModuleInit` o `main.ts`) por cada
 * proveedor que esté efectivamente activo (no en modo `disabled`/`mock`/`dev_null`).
 */
export type ProviderRequirement = {
  /** Valor de configuración que identifica al proveedor activo, p. ej. env.NOTIFICATION_EMAIL_PROVIDER. */
  providerValue: string;
  /** Nombre descriptivo para el mensaje de error (no necesariamente igual a providerValue). */
  channelOrDomain: string;
  /** Variables de entorno cuyo valor debe ser un string no vacío para que este proveedor funcione. */
  requiredEnvVars: Array<{ name: string; value: string | undefined }>;
};

export class ProviderConfigError extends Error {
  constructor(
    public readonly channelOrDomain: string,
    public readonly providerValue: string,
    public readonly missingVars: string[],
  ) {
    super(
      `Configuración incompleta para ${channelOrDomain}="${providerValue}": faltan las variables de entorno ` +
        `${missingVars.join(', ')}. El proceso no puede arrancar con un proveedor activo mal configurado — ` +
        `o se corrige la configuración, o se cambia ${channelOrDomain} a un modo deshabilitado/mock.`,
    );
    this.name = 'ProviderConfigError';
  }
}

/**
 * Lanza `ProviderConfigError` (pensado para abortar el boot) si el proveedor declarado no tiene
 * todas sus variables de entorno requeridas. No hace nada si `providerValue` corresponde a un
 * modo que no requiere configuración externa (el llamador decide cuáles pasar aquí: normalmente
 * se filtra antes de llamar esta función para los modos `disabled`/`mock_*`/`dev_null`).
 */
export function assertProviderConfigured(requirement: ProviderRequirement): void {
  const missing = requirement.requiredEnvVars.filter((entry) => !entry.value || entry.value.trim().length === 0).map((entry) => entry.name);
  if (missing.length > 0) {
    throw new ProviderConfigError(requirement.channelOrDomain, requirement.providerValue, missing);
  }
}

/**
 * Variante que evalúa una lista de requerimientos y agrega TODOS los errores en un solo throw,
 * para que el operador vea de una vez todo lo que falta en vez de corregir uno por uno y
 * reiniciar repetidamente.
 */
export function assertAllProvidersConfigured(requirements: ProviderRequirement[]): void {
  const errors: ProviderConfigError[] = [];
  for (const requirement of requirements) {
    try {
      assertProviderConfigured(requirement);
    } catch (error) {
      if (error instanceof ProviderConfigError) errors.push(error);
      else throw error;
    }
  }
  if (errors.length > 0) {
    throw new Error(`Configuración de proveedores incompleta al arrancar:\n${errors.map((error) => `- ${error.message}`).join('\n')}`);
  }
}
