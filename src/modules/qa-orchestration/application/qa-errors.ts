/**
 * @file Utilidad de aplicación: errores de la API QA con código de dominio y mensaje humano.
 * @business Esta pieza hace que el portal diga «ya hay una corrida en curso» en vez de «Conflicto».
 * @system el filtro HTTP publica `error.code` sólo si la excepción trae `{ code }`; sin eso todo
 *   409 salía como `CONFLICT` con el código escondido en el mensaje.
 */
const MESSAGES: Record<string, string> = {
  QA_TENANT_REQUIRED: 'La sesión no tiene tenant: no se puede operar el laboratorio QA.',
  QA_PLAN_NOT_FOUND: 'Ese plan no existe o no es tuyo. Valida la preparación otra vez.',
  PLAN_CHANGED: 'El plan cambió desde que se validó (receta o configuración). Valida la preparación otra vez.',
  PLAN_EXPIRED: 'El plan validado venció (15 minutos). Valida la preparación otra vez.',
  IDEMPOTENCY_KEY_REUSED: 'Esa clave de lanzamiento ya se usó con otro plan.',
  IDEMPOTENCY_KEY_REQUIRED: 'Falta la cabecera Idempotency-Key (8 a 120 caracteres).',
  QA_RUN_ALREADY_ACTIVE: 'Ya hay una corrida QA en curso en este tenant; espera a que termine o cancélala.',
  WORKER_UNAVAILABLE: 'No hay un worker QA disponible. No se ha iniciado ninguna persona.',
  QA_RUN_NOT_FOUND: 'Esa corrida no existe.',
  QA_TEMPLATE_NOT_FOUND: 'Esa plantilla de recorrido no existe.',
  QA_WORKFLOW_NOT_FOUND: 'Ese flujo no está en el inventario.',
  QA_DATASET_MODE_UNSUPPORTED: 'La plantilla no admite ese tipo de datos.',
};

export function qaError(code: string, message?: string): { code: string; message: string } {
  return { code, message: message ?? MESSAGES[code] ?? code };
}
