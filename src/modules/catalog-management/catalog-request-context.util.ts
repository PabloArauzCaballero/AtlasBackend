/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system arma el contexto de red e idempotencia que acompaña a cada escritura de catálogo.
 */
import { RequestWithNetwork, userAgentFrom } from '../../common/utils/http/headers.util.js';

export type RequestContext = {
  tenantId: string;
  ipAddress: string | null;
  userAgent: string | null;
  idempotencyKey?: string;
};

/**
 * Quién pidió la escritura y desde dónde. Vive aparte porque lo comparten los dos controllers del
 * módulo —catálogos y gobierno de reglas— y duplicarlo era la vía por la que una de las dos rutas
 * acabara registrando menos rastro que la otra.
 */
export function contextFrom(tenantId: string, idempotencyKey: string | undefined, request: RequestWithNetwork): RequestContext {
  return {
    tenantId,
    ipAddress: request.ip ?? null,
    userAgent: userAgentFrom(request),
    idempotencyKey,
  };
}
