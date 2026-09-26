/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
/**
 * El contexto de una corrida de QA, tal como viaja hasta el emulador de proveedores.
 *
 * Hoy `callMockServer` manda al emulador `{ scenario, input }` y nada más (hallazgo H10 del paquete
 * QA). Con una sola llamada eso alcanza. Con un motor que simula cientos de personas en paralelo no:
 * sin `runId` el emulador no puede aislar el estado de cada corrida, sin `personaKey` no puede
 * separar la idempotencia de dos clientes, y sin `logicalOperationId`/`attempt` no puede aplicar un
 * plan de fallos del estilo "los dos primeros intentos de ESTA operación fallan". Sobre todo: sin
 * nada de esto, el journal del emulador no puede demostrar que una llamada concreta salió por la
 * red —que es la única forma de distinguir un E2E real de uno que interceptó `fetch`—.
 *
 * Tres reglas que este tipo existe para hacer cumplir:
 *
 * 1. **Es metadata de control, no de negocio.** No entra en `input`. Si entrara, cambiaría el hash
 *    del cuerpo y con él la idempotencia y la caché: dos llamadas idénticas de dos corridas
 *    distintas dejarían de ser la misma intención por un campo que el dominio no conoce.
 * 2. **No se deriva de una cabecera del cliente.** Lo arma quien ejecuta una corrida autorizada. El
 *    `runToken` lo entregó el emulador al dar de alta la corrida; sin él, nombrarla no sirve.
 * 3. **Nunca en producción.** `attachRunContext` lo deja fuera si el runtime es productivo o si el
 *    proveedor no está en `mock_server`. Un contexto de QA que llega a un proveedor real es, en el
 *    mejor caso, ruido en los logs de un tercero.
 *
 * Lo que NO viaja: la `Authorization` del cliente. El emulador no la necesita, no debe verla, y
 * reenviarla convertiría un servicio de pruebas en un lugar donde aparecen tokens de sesión reales.
 */
export type QaRunContext = {
  tenantId: string;
  runId: string;
  /** Devuelto por el alta de la corrida en el emulador. Sin él, nombrar la corrida es 401. */
  runToken: string;
  personaKey?: string;
  /** Identifica la operación del recorrido, no el request HTTP: un retry conserva la misma. */
  logicalOperationId?: string;
  attempt?: number;
  /** Epoch del emulador al dar de alta la corrida. Distinto ⇒ el emulador se reinició. */
  epoch?: string;
  schemaVersion?: string;
  /** W3C traceparent. Sólo correlaciona; no identifica persona ni concede permisos. */
  traceparent?: string;
};

const HEADERS = {
  tenantId: 'x-mock-tenant-id',
  runId: 'x-mock-run-id',
  runToken: 'x-mock-run-token',
  personaKey: 'x-mock-persona-key',
  logicalOperationId: 'x-mock-logical-operation-id',
  attempt: 'x-mock-attempt',
  epoch: 'x-mock-epoch',
  schemaVersion: 'x-mock-schema-version',
  traceparent: 'traceparent',
} as const;

/** Acotado: estas etiquetas terminan en el journal del emulador y en el tablero del portal. */
function label(value: string | undefined, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Cabeceras del contexto, o `{}` si no corresponde mandarlo.
 *
 * La decisión de si el runtime es productivo llega como dato (`productionRuntime`) en vez de
 * leerse aquí: este módulo es de dominio y no puede depender de la capa de aplicación, y además
 * así la regla se puede probar sin manipular variables de entorno del proceso.
 *
 * @param mode Modo efectivo del proveedor. Sólo `mock_server` recibe contexto.
 */
export function runContextHeaders(
  context: QaRunContext | undefined,
  { mode, productionRuntime }: { mode: string; productionRuntime: boolean },
): Record<string, string> {
  if (!context) return {};
  if (mode !== 'mock_server') return {};
  // Un contexto de QA en un runtime productivo es un defecto, no una funcionalidad: se descarta en
  // silencio en vez de dejar que una configuración equivocada mande metadata de pruebas afuera.
  if (productionRuntime) return {};
  if (!label(context.tenantId) || !label(context.runId) || !label(context.runToken)) return {};

  const headers: Record<string, string> = {
    [HEADERS.tenantId]: label(context.tenantId) as string,
    [HEADERS.runId]: label(context.runId) as string,
    [HEADERS.runToken]: context.runToken,
  };
  const personaKey = label(context.personaKey);
  if (personaKey) headers[HEADERS.personaKey] = personaKey;
  const logicalOperationId = label(context.logicalOperationId);
  if (logicalOperationId) headers[HEADERS.logicalOperationId] = logicalOperationId;
  if (Number.isInteger(context.attempt) && (context.attempt as number) >= 1) {
    headers[HEADERS.attempt] = String(context.attempt);
  }
  const epoch = label(context.epoch, 64);
  if (epoch) headers[HEADERS.epoch] = epoch;
  const schemaVersion = label(context.schemaVersion, 32);
  if (schemaVersion) headers[HEADERS.schemaVersion] = schemaVersion;
  const traceparent = label(context.traceparent, 64);
  if (traceparent) headers[HEADERS.traceparent] = traceparent;
  return headers;
}
