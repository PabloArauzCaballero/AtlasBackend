/**
 * @file Guard de la credencial de servicio del Motor de Decisión.
 * @business Sólo el Motor, con su clave compartida, puede cerrar aquí una revisión que resolvió una persona allí.
 * @system aplica `assertEngineCallbackKey` sobre `x-engine-callback-key` antes del handler. Se combina con
 *   la marca pública porque el guard global de sesión no entiende credenciales de servicio (otra audiencia).
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { assertEngineCallbackKey, ENGINE_CALLBACK_HEADER } from '../utils/auth/engine-callback-key.util.js';

type RequestWithHeaders = { headers: Record<string, string | string[] | undefined> };

/**
 * La misma regla que ya aplicaban a mano los callbacks de identidad, riesgo y crédito, puesta como
 * guard para que se LEA desde fuera del handler: sin clave configurada no pasa nadie (401), y la
 * comparación es en tiempo constante.
 *
 * Existe porque una ruta sin sesión que comprueba su credencial DENTRO del handler es indistinguible,
 * para los gates que leen el código, de una ruta abierta: Flow Intelligence la marcaba como
 * escritura pública sin protección. Como guard, se declara y se reconoce por su nombre.
 */
@Injectable()
export class EngineCallbackKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const header = request.headers[ENGINE_CALLBACK_HEADER];
    assertEngineCallbackKey(Array.isArray(header) ? header[0] : header);
    return true;
  }
}
