/**
 * @file Utilidad pura y sin estado: transforma o valida datos.
 * @business Esta pieza es lo que impide que un circuito de decisión se cierre sin credencial.
 * @system comprueba la clave compartida con la que el Motor de Decisión llama de vuelta a Atlas.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { env } from '../../../config/env.js';

/** Cabecera con la que el Motor se identifica al devolver una resolución. */
export const ENGINE_CALLBACK_HEADER = 'x-engine-callback-key';

/**
 * Sin clave CONFIGURADA no se acepta a nadie, ni siquiera con cabecera: un circuito que se puede
 * cerrar sin credencial es peor que uno que no se cierra. Es la misma regla para identidad, riesgo
 * y crédito, y por eso vive en un solo sitio.
 */
export function assertEngineCallbackKey(clave: string | undefined): void {
  const esperada = env.ENGINE_CALLBACK_API_KEY;
  if (!esperada || !clave || !sameSecret(clave, esperada)) {
    throw new UnauthorizedException('Credencial de servicio invalida.');
  }
}

/**
 * Comparación en tiempo constante. Con `!==` el tiempo de respuesta depende de cuántos caracteres
 * iniciales acierta quien llama, y una clave se puede adivinar carácter a carácter midiendo. Las dos
 * pasan por un HMAC con una clave aleatoria de este proceso antes de `timingSafeEqual`: iguala las
 * longitudes (esa función lanza si difieren, y la excepción filtraría la longitud de la clave) sin
 * dejar un hash estable de la credencial que se pueda precalcular.
 */
const CLAVE_DE_COMPARACION = randomBytes(32);

function sameSecret(recibida: string, esperada: string): boolean {
  return timingSafeEqual(digest(recibida), digest(esperada));
}

function digest(valor: string): Buffer {
  return createHmac('sha256', CLAVE_DE_COMPARACION).update(valor).digest();
}
