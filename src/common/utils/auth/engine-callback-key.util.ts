/**
 * @file Utilidad pura y sin estado: transforma o valida datos.
 * @business Esta pieza es lo que impide que un circuito de decisión se cierre sin credencial.
 * @system comprueba la clave compartida con la que el Motor de Decisión llama de vuelta a Atlas.
 */
import { timingSafeEqual } from 'node:crypto';
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
 * iniciales acierta quien llama, y una clave se puede adivinar carácter a carácter midiendo.
 * `timingSafeEqual` lanza si las longitudes difieren (y la excepción filtraría la longitud de la
 * clave), así que las dos se copian a búferes del mismo tamaño y la longitud se compara aparte, sin
 * cortocircuito. No se hashea la credencial: un hash rápido de una clave es justo lo que CodeQL
 * señala como `js/insufficient-password-hash`, y aquí no hace falta.
 */
function sameSecret(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  const largo = Math.max(a.length, b.length);
  const iguales = timingSafeEqual(rellenar(a, largo), rellenar(b, largo));
  return iguales && a.length === b.length;
}

function rellenar(valor: Buffer, largo: number): Buffer {
  const destino = Buffer.alloc(largo);
  valor.copy(destino);
  return destino;
}
