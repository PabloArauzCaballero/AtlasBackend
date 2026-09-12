/**
 * @file Regla de dominio pura: detección de secretos en lo que alguien escribe en el chat.
 * @business Un cliente asustado pega su contraseña o su código; eso no puede quedar legible para siempre.
 * @system detecta con contexto, devuelve el texto redactado y el motivo; nunca borra el original.
 */

/** Qué se encontró y con qué etiqueta se sustituyó en la vista normal. */
export interface DlpFinding {
  readonly kind: 'OTP' | 'PASSWORD' | 'API_SECRET' | 'BEARER_TOKEN' | 'PRIVATE_KEY' | 'CARD_NUMBER';
  readonly placeholder: string;
}

export interface DlpResult {
  readonly hasSecrets: boolean;
  /** El texto tal como se mostrará. Igual al original cuando no hay hallazgos. */
  readonly redactedText: string;
  readonly findings: readonly DlpFinding[];
  /** Motivo legible para el evento `CONTENT_REDACTED_FROM_VIEW`. */
  readonly reason: string | null;
}

/**
 * Palabras que convierten un número en un secreto.
 *
 * Sin contexto, «mi cuota es 123456» se redactaría igual que «mi código es 123456», y un chat lleno
 * de `[REDACTADO]` deja de servir para atender a nadie. Bloquear a ciegas todos los números de seis
 * dígitos es la forma más rápida de que el equipo pida desactivar el control.
 */
const OTP_CONTEXT = /(otp|c[óo]digo|codigo|verificaci[óo]n|verificacion|pin|token|clave temporal|sms)/i;
const OTP_NUMBER = /\b\d{6}\b/;

const PASSWORD_DECLARED = /\b(mi\s+)?(contrase[nñ]a|password|clave|passwd)\b\s*(es|:|=)\s*\S+/i;
const API_SECRET = /\b(api[_-]?key|client[_-]?secret|secret[_-]?key|access[_-]?key)\b\s*(es|:|=)\s*\S+/i;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/i;
const PRIVATE_KEY = /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/;
// Sólo con separadores o 16 dígitos seguidos: un número de préstamo largo no es una tarjeta.
const CARD_NUMBER = /\b(?:\d[ -]?){15,18}\d\b/;

const PLACEHOLDER: Readonly<Record<DlpFinding['kind'], string>> = {
  OTP: '[código de verificación oculto]',
  PASSWORD: '[contraseña oculta]',
  API_SECRET: '[secreto oculto]',
  BEARER_TOKEN: '[token oculto]',
  PRIVATE_KEY: '[clave privada oculta]',
  CARD_NUMBER: '[número oculto]',
};

/**
 * Inspecciona el mensaje y devuelve la versión que se puede mostrar.
 *
 * No decide qué se hace con el original: eso es del servicio, que lo guarda cifrado y escribe el
 * evento. Aquí sólo se responde qué hay y cómo se ve sin ello. Separarlo permite probar la
 * detección sin base de datos y —más importante— cambiar la política de conservación sin tocar las
 * reglas de detección.
 */
export function inspectMessageBody(body: string): DlpResult {
  const findings: DlpFinding[] = [];
  let text = body;

  if (PRIVATE_KEY.test(text)) {
    findings.push({ kind: 'PRIVATE_KEY', placeholder: PLACEHOLDER.PRIVATE_KEY });
    text = text.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, PLACEHOLDER.PRIVATE_KEY);
  }
  if (BEARER.test(text)) {
    findings.push({ kind: 'BEARER_TOKEN', placeholder: PLACEHOLDER.BEARER_TOKEN });
    text = text.replace(new RegExp(BEARER.source, 'gi'), PLACEHOLDER.BEARER_TOKEN);
  }
  if (API_SECRET.test(text)) {
    findings.push({ kind: 'API_SECRET', placeholder: PLACEHOLDER.API_SECRET });
    text = text.replace(new RegExp(API_SECRET.source, 'gi'), PLACEHOLDER.API_SECRET);
  }
  if (PASSWORD_DECLARED.test(text)) {
    findings.push({ kind: 'PASSWORD', placeholder: PLACEHOLDER.PASSWORD });
    text = text.replace(new RegExp(PASSWORD_DECLARED.source, 'gi'), PLACEHOLDER.PASSWORD);
  }
  if (OTP_CONTEXT.test(text) && OTP_NUMBER.test(text)) {
    findings.push({ kind: 'OTP', placeholder: PLACEHOLDER.OTP });
    text = text.replace(new RegExp(OTP_NUMBER.source, 'g'), PLACEHOLDER.OTP);
  }
  if (CARD_NUMBER.test(text)) {
    findings.push({ kind: 'CARD_NUMBER', placeholder: PLACEHOLDER.CARD_NUMBER });
    text = text.replace(new RegExp(CARD_NUMBER.source, 'g'), PLACEHOLDER.CARD_NUMBER);
  }

  return {
    hasSecrets: findings.length > 0,
    redactedText: text,
    findings,
    reason: findings.length ? `Contenido con ${findings.map((f) => f.kind).join(', ')} oculto de la vista normal.` : null,
  };
}

/**
 * El aviso que ningún agente debería tener que acordarse de escribir.
 *
 * Se envía automáticamente cuando el sistema detecta que alguien está a punto de compartir —o ya
 * compartió— un secreto. Que lo diga el sistema y no la persona es lo que lo hace consistente: un
 * agente cansado a las once de la noche es exactamente quien no lo escribe.
 */
export const SUPPORT_NEVER_ASKS_WARNING =
  'Por tu seguridad: Atlas nunca te pedirá tu contraseña, tu PIN, tu código de verificación ni tu ' +
  'código de recuperación. Si alguien te los pide —aunque diga ser de Atlas— no los compartas.';
