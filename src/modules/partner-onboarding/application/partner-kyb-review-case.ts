/**
 * @file Abre en la cola del Motor el caso de un expediente de comercio que espera a una persona.
 * @business Un comercio en revisión tiene que aparecer en la bandeja donde se aprueba, con su expediente.
 * @system `PUT /v1/manual-reviews/by-execution/:executionId/onboarding-dossier` con `openIfMissing` (la misma vía que identidad); idempotente por ejecución, nunca lanza.
 */
/**
 * Lo único que se necesita del cliente del Motor. Se declara aquí, estructural, para no sumar una
 * dependencia de este módulo hacia `decision-engine` (la frontera la vigila `check:architecture`).
 */
type KybCaseOpener = {
  manualReviews: {
    putOnboardingDossier(
      executionId: string,
      body: {
        dossier: Record<string, unknown>;
        openIfMissing: { queueCode: string; priority: number; slaMinutes: number; motivo: string };
      },
    ): Promise<{ ok: true; caseCode: string | null } | { ok: false }>;
  };
};

/** La cola del Motor donde una persona atiende los expedientes de comercios. */
export const KYB_QUEUE_CODE = 'MERCHANT_KYB';

/** Prioridad y plazo (minutos) del caso abierto así: un comercio espera para poder cobrar. */
const KYB_CASE_PRIORITY = 50;
const KYB_CASE_SLA_MINUTES = 1_440;

/**
 * Pide al Motor el caso de la ejecución. `null` si no responde o si el caso ya está cerrado.
 *
 * El `requestId` de la ejecución (`kyb-<comercio>-…`) es lo que enlaza el caso con el expediente en
 * el portal del Motor. El anexo lleva además lo que arma `buildKybDossier` (quién es el comercio,
 * quién lo representa, qué le falta) cuando quien llama lo tiene; sin él viaja sólo a quién pertenece.
 *
 * Sirve también cuando el caso YA existe (lo abrió el grafo): el Motor adjunta el anexo sin tocar
 * estado ni asignación, y repetir el envío lo reemplaza.
 */
export async function openKybReviewCase(
  client: KybCaseOpener,
  input: { executionId: string; profileId: string; reason: string | null; dossier?: Record<string, unknown> },
): Promise<{ caseCode: string } | null> {
  const result = await client.manualReviews.putOnboardingDossier(input.executionId, {
    dossier: { ...input.dossier, origen: 'KYB_COMERCIO', expedienteId: input.profileId },
    openIfMissing: {
      queueCode: KYB_QUEUE_CODE,
      priority: KYB_CASE_PRIORITY,
      slaMinutes: KYB_CASE_SLA_MINUTES,
      motivo: (input.reason ?? 'KYB_REVISION_MANUAL').slice(0, 200),
    },
  });
  return result.ok && result.caseCode ? { caseCode: result.caseCode } : null;
}
