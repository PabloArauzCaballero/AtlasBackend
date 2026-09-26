/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */

/**
 * Qué campos tiene que traer la respuesta de un proveedor para que signifique lo que dice.
 *
 * El defecto que cierra este archivo es sutil y por eso importa: los normalizadores rellenan lo
 * que falta. `segip.adapter.ts` hace `num(payload.matchScore) ?? 0`, y `bool(payload.documentExists)
 * ?? status === 'FOUND'`. Con eso, una respuesta 200 `{"status":"FOUND"}` —sin un solo dato de la
 * verificación— sale del pipeline como cinco observaciones bien formadas: `identity_document_exists
 * = true` (derivado del propio status, no de un hecho), `identity_name_match_score = 0` y
 * `verified: false`. Es decir: INDISTINGUIBLE de una identidad que el registro estatal contestó con
 * baja coincidencia. Un cambio incompatible del proveedor no rompe nada; degrada en silencio la
 * evidencia de un expediente KYC.
 *
 * La regla, entonces: un campo ausente no es un cero. Si el contrato del proveedor dice que una
 * respuesta `FOUND` trae `matchScore`, una respuesta `FOUND` sin `matchScore` es una violación de
 * contrato identificable, la request queda `FAILED` con su motivo, y no se escriben observaciones
 * inventadas. Es exactamente el oráculo "contrato roto con HTTP 200" del paquete QA.
 *
 * No valida los escenarios de fallo (`PROVIDER_UNAVAILABLE`, `UNAUTHORIZED`…): ahí el proveedor no
 * llegó a construir una respuesta de negocio y exigirle campos sería exigir datos de una llamada
 * que no ocurrió.
 */

export type ContractViolation = {
  field: string;
  expected: string;
  received: string;
};

type FieldType = 'boolean' | 'number' | 'string';

type StatusContract = {
  /** Campos que esa respuesta DEBE traer, con su tipo. */
  required: Record<string, FieldType>;
};

/**
 * Por proveedor, por veredicto. Sólo los veredictos que afirman algo del negocio: si el proveedor
 * dice `DATA_NOT_AVAILABLE` está diciendo precisamente que no tiene el dato, y pedirle el dato
 * sería una contradicción.
 */
const CONTRACTS: Record<string, Record<string, StatusContract>> = {
  SEGIP: {
    FOUND: {
      required: {
        documentExists: 'boolean',
        matchScore: 'number',
        nameMatches: 'boolean',
        birthDateMatches: 'boolean',
        providerReference: 'string',
      },
    },
    PARTIAL_MATCH: {
      required: { documentExists: 'boolean', matchScore: 'number', manualReviewRequired: 'boolean', providerReference: 'string' },
    },
    MANUAL_REVIEW_REQUIRED: {
      required: { documentExists: 'boolean', matchScore: 'number', manualReviewRequired: 'boolean', providerReference: 'string' },
    },
    NOT_FOUND: { required: { documentExists: 'boolean', providerReference: 'string' } },
  },
  INFOCENTER: {
    COMPLETED: {
      required: { bureauScore: 'number', activeDebtCount: 'number', maxDaysPastDue12m: 'number', providerReference: 'string' },
    },
    BLOCKED_BY_COST_POLICY: { required: { reasonCode: 'string' } },
    MANUAL_REVIEW_REQUIRED: { required: { bureauScore: 'number', manualReviewRequired: 'boolean', reasonCode: 'string' } },
  },
  QR_GENERIC: {
    PAYMENT_VERIFIED: { required: { amountMatches: 'boolean', referenceMatches: 'boolean', providerReference: 'string' } },
    PAYMENT_PARTIAL_MATCH: { required: { amountMatches: 'boolean', referenceMatches: 'boolean', providerReference: 'string' } },
    DUPLICATE_PAYMENT_REFERENCE: { required: { duplicateDetected: 'boolean', providerReference: 'string' } },
    PAYMENT_NOT_FOUND: { required: { amountMatches: 'boolean', referenceMatches: 'boolean', providerReference: 'string' } },
  },
  BANKING_GENERIC: {
    VERIFIED: { required: { amountMatches: 'boolean', referenceMatches: 'boolean', providerReference: 'string' } },
    AMOUNT_MISMATCH: { required: { amountMatches: 'boolean', referenceMatches: 'boolean', providerReference: 'string' } },
    PENDING: { required: { providerReference: 'string' } },
    QR_GENERATED: { required: { qrId: 'string', qrPayload: 'string', amount: 'number', currency: 'string' } },
    QR_EXPIRED: { required: { qrId: 'string', expiresAt: 'string' } },
  },
  TELCO_GENERIC: {
    VERIFIED: {
      required: {
        phoneNumberActive: 'boolean',
        lineAgeDays: 'number',
        lineAgeBucket: 'string',
        recentSimChangeDetected: 'boolean',
        simSwapRiskLevel: 'string',
        ownerMatchScore: 'number',
      },
    },
  },
  FACEBOOK_META: {
    CONNECTED: { required: { nameMatchScore: 'number', emailMatch: 'boolean', accountAgeAvailable: 'boolean' } },
  },
  WHATSAPP_GENERIC: {
    OTP_VERIFIED: { required: { whatsappReachable: 'boolean', phoneMatch: 'boolean', contactabilityScore: 'number' } },
    OTP_UNCERTAIN: { required: { whatsappReachable: 'boolean', contactabilityScore: 'number' } },
    NOT_REACHABLE: { required: { whatsappReachable: 'boolean', contactabilityScore: 'number' } },
  },
  DIGITAL_TRUST_GENERIC: {
    COMPLETED: {
      required: { emailRiskLevel: 'string', deviceRiskScore: 'number', ipRiskScore: 'number', syntheticIdentityRiskLevel: 'string' },
    },
    LOW_CONFIDENCE: { required: { syntheticIdentityRiskLevel: 'string', reasonCode: 'string' } },
  },
};

/** `CGIP` y `QR_BCB_GENERIC` son alias de los códigos canónicos, igual que en `toProviderCode`. */
const ALIASES: Record<string, string> = { CGIP: 'SEGIP', QR_BCB_GENERIC: 'QR_GENERIC' };

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matches(value: unknown, expected: FieldType): boolean {
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && value.length > 0;
}

/**
 * @returns Las violaciones encontradas. Vacío significa "esta respuesta se puede normalizar".
 *
 * Un proveedor o un veredicto sin contrato declarado devuelve vacío: este archivo endurece lo que
 * conoce y no bloquea lo que todavía no describe. La alternativa —rechazar todo lo no declarado—
 * convertiría cada proveedor nuevo en una caída de producción hasta que alguien lo agregue aquí.
 */
export function validateProviderResponse(providerCode: string, payload: Record<string, unknown>, status: string): ContractViolation[] {
  const canonical = ALIASES[providerCode.toUpperCase()] ?? providerCode.toUpperCase();
  const contract = CONTRACTS[canonical]?.[status];
  if (!contract) return [];

  const violations: ContractViolation[] = [];
  for (const [field, expected] of Object.entries(contract.required)) {
    const value = payload[field];
    if (value === undefined) {
      violations.push({ field, expected, received: 'undefined' });
      continue;
    }
    if (!matches(value, expected)) violations.push({ field, expected, received: typeOf(value) });
  }
  return violations;
}

/** Veredicto propio para una respuesta que llegó bien por HTTP y mal por contrato. */
export const PROVIDER_CONTRACT_VIOLATION = 'PROVIDER_CONTRACT_VIOLATION';

export function contractViolationReason(violations: ContractViolation[]): string {
  const detail = violations.map((violation) => `${violation.field}:${violation.expected}→${violation.received}`).join(', ');
  return `${PROVIDER_CONTRACT_VIOLATION}(${detail})`;
}
