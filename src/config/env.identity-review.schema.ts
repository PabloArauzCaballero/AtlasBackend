/**
 * @file Variables de la política de revisión de identidad, en su propio módulo.
 * @business Mientras no haya corpus para calibrar la prueba de vida, quien decide si una identidad es real es una persona.
 * @system se separa de `env.schema.ts` por la misma razón que Twilio y Brevo: ese archivo roza el gate de tamaño.
 */
import { otpDeliveryEnvShape } from './env.otp.schema.js';
import { phoneHashEnvShape } from './env.phone-hash.schema.js';
import { booleanEnvDefaultTrueSchema } from './env.primitives.js';

export const identityReviewEnvShape = {
  /*
    Si TODA verificación de identidad del alta la decide una persona.

    Por qué existe: la prueba de vida (selfie) y el parecido carnet-selfie no tienen corpus con el que
    calibrarse (2026-09-28). Un umbral sin calibrar aprueba y rechaza por azar, y un rechazo
    automático de una persona real es el peor error del alta. Con esto encendido:
      - el veredicto del Motor (VERIFICADO / RECHAZADO) queda como SUGERENCIA en el intento
        (`engineDecision`) y el intento pasa a IN_REVIEW;
      - el resultado del registro estatal (SEGIP FOUND / NOT_FOUND) tampoco cierra la identidad;
      - se abre un caso `identity_review` en la bandeja de operaciones, y la decisión se toma en el
        panel de identidad del expediente (`identity-verification/decision`), que cierra el caso.
    El cliente ve «Solicitud en revisión» y, al aprobarse, recibe «Tu cuenta ha sido verificada».

    Viene ENCENDIDO por defecto: apagarlo es la decisión explícita, y se toma cuando el corpus exista.
  */
  IDENTITY_REQUIRE_HUMAN_REVIEW: booleanEnvDefaultTrueSchema,
} as const;

/** El alta del cliente en un solo bloque de `env.schema.ts`: entrega del código, revisión de identidad y clave de los teléfonos. */
export const onboardingEnvShape = { ...otpDeliveryEnvShape, ...identityReviewEnvShape, ...phoneHashEnvShape } as const;
