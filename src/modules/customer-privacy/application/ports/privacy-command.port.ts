/**
 * @file Puerto de comandos de privacidad (AT-028): revocación, retención y evidencia.
 * @business Revocar es idempotente (revocar dos veces deja UNA revocación auditada); una solicitud de
 *   privacidad no elimina evidencia cuya retención válida exige conservar (KYC, antifraude); la
 *   evidencia tiene dueño explícito y no viaja completa en eventos.
 * @system Interfaz + token + reglas puras de retención. Los adaptadores reales llegan con AT-041
 *   (eventos) y la migración de `CustomerPrivacyService`; hoy el contrato fija la semántica.
 */
export type RevokeConsentCommand = Readonly<{
  tenantId: string;
  customerId: string;
  purposeCode: string;
  reasonCode: string;
  actor: Readonly<{ type: string; id: string | null }>;
  /** Clave del comando: dos envíos con la misma clave producen una sola revocación. */
  commandKey: string;
}>;

export type RevokeConsentResult = Readonly<{ revoked: boolean; alreadyRevoked: boolean; revision: string | null; effectiveAt: string }>;

export type PrivacyRequestKind = 'access' | 'rectification' | 'erasure' | 'portability';

export type RetentionVerdict = Readonly<{
  /** Qué se puede borrar o anonimizar y qué debe conservarse, por categoría de dato. */
  erasable: readonly string[];
  retained: readonly { category: string; policy: string; until: string | null }[];
}>;

export interface PrivacyCommandPort {
  revokeConsent(command: RevokeConsentCommand): Promise<RevokeConsentResult>;
  /** Decide, sin borrar nada, qué puede atender una solicitud de privacidad y qué no. */
  assessRetention(tenantId: string, customerId: string, kind: PrivacyRequestKind): Promise<RetentionVerdict>;
}

export const PRIVACY_COMMAND_PORT = 'atlas.privacy.command-port';

/**
 * Política de retención por categoría (pura). Lo que la ley o el antifraude exigen conservar no se
 * borra a petición del titular: se conserva con plazo y se le informa. Los plazos son los que el
 * sistema aplica hoy; cambiarlos es una decisión de negocio con su propia tarea.
 */
export const RETENTION_POLICIES: Readonly<Record<string, { policy: string; years: number | null }>> = Object.freeze({
  identity_evidence: { policy: 'kyc_legal_retention', years: 10 },
  consent_records: { policy: 'consent_audit_trail', years: 10 },
  fraud_cases: { policy: 'antifraud_retention', years: 10 },
  credit_history: { policy: 'credit_legal_retention', years: 10 },
  marketing_preferences: { policy: 'erasable_on_request', years: null },
  device_signals: { policy: 'erasable_on_request', years: null },
  app_content_state: { policy: 'erasable_on_request', years: null },
});

export function assessRetentionPolicy(kind: PrivacyRequestKind, now: Date): RetentionVerdict {
  if (kind !== 'erasure') return Object.freeze({ erasable: [], retained: [] });
  const erasable: string[] = [];
  const retained: { category: string; policy: string; until: string | null }[] = [];
  for (const [category, rule] of Object.entries(RETENTION_POLICIES)) {
    if (rule.years === null) erasable.push(category);
    else
      retained.push({
        category,
        policy: rule.policy,
        until: new Date(Date.UTC(now.getUTCFullYear() + rule.years, now.getUTCMonth(), now.getUTCDate())).toISOString(),
      });
  }
  return Object.freeze({ erasable: Object.freeze(erasable), retained: Object.freeze(retained) });
}
