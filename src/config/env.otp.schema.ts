/**
 * @file Variables de la entrega de códigos de un solo uso (OTP), en su propio módulo.
 * @business Esta pieza decide qué pasa cuando el canal que pidió la persona no puede entregar el código.
 * @system se separa de `env.schema.ts` por la misma razón que Twilio y Brevo: ese archivo roza el gate de tamaño.
 */
import { booleanEnvSchema } from './env.primitives.js';

export const otpDeliveryEnvShape = {
  /*
    Si un código de teléfono puede salir por CORREO cuando el SMS no puede entregarse.

    Por qué existe: el 2026-09-21 el alta del cliente estuvo un día entero parada en TEST. La cuenta
    de Brevo no tiene crédito de SMS, así que sus 25 envíos del día figuran como `rejected` en el
    informe de Brevo —`accepted: 0`, `delivered: 0`— mientras ATLAS decía «Código enviado»: la API de
    Brevo responde `201` con un id y sólo descarta el mensaje después. Sin crédito no hay teléfono al
    que llegue nada, y el alta no tiene por dónde continuar.

    Qué NO es: esto no verifica el teléfono. El código llega al correo del MISMO cliente, que es un
    contacto suyo, pero quien lo escribe demuestra que tiene ese correo, no ese número. Por eso es
    una decisión de despliegue y no una regla del producto, y por eso viene APAGADO por defecto:
    en producción un SMS que no sale es un incidente del proveedor que hay que ver y arreglar, no
    algo que el sistema deba rodear en silencio. En dev y en test, donde no hay crédito de SMS y lo
    que se prueba es el recorrido, encenderlo es lo que deja avanzar.

    Cuando actúa, el desenlace lo dice todo el camino: la respuesta lleva `deliveredChannel: 'email'`,
    el intento queda registrado con su canal real y la pantalla lo explica en vez de callárselo.
  */
  OTP_SMS_FALLBACK_TO_EMAIL: booleanEnvSchema,
} as const;
