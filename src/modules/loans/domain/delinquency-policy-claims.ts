/**
 * @file Afirmaciones que la política de mora NO puede publicar porque el sistema no las cumple.
 * @business Una política publicada se le opone al cliente cuando reclama: publicar lo que no se hace
 *   es peor que publicar menos. La v1 prometió avisos, interés penal, bloqueo de compras y reporte a
 *   una central de riesgo, y ninguna de las cuatro cosas existía.
 * @system lista única (patrón + motivo) y detector puro sobre los textos de una versión publicada.
 */

export type UnbackedClaim = {
  /** Nombre corto de la afirmación, para el mensaje de la prueba que la encuentre. */
  readonly claim: string;
  readonly pattern: RegExp;
  /** Por qué no se puede publicar: qué falta en el sistema. Se quita de aquí cuando exista. */
  readonly why: string;
};

/**
 * Lo que el sistema NO hace hoy. Cada entrada sale cuando se implemente de verdad, no antes.
 *
 * Los patrones buscan la AFIRMACIÓN, no la palabra suelta: «volvemos a calcular tu límite» es cierto
 * y no debe chocar con nada de aquí.
 */
export const UNBACKED_DELINQUENCY_CLAIMS: readonly UnbackedClaim[] = [
  {
    claim: 'se envía un recordatorio',
    pattern: /se env[ií]a(?:n)?\s+(?:un\s+)?(?:recordatorio|aviso)|te\s+(?:avisamos|recordamos)/i,
    why: 'Ningún código emite avisos de cuota o de mora (`installment.*`, `collection.reminder.*`): no hay emisor.',
  },
  {
    claim: 'interés penal o moratorio',
    pattern: /inter[eé]s(?:es)?\s+(?:penal|penales|moratori[oa]s?)|tasa\s+moratoria|cargo\s+por\s+mora\s+del|recargo\s+por\s+mora/i,
    why: '`late_fee_amount` nace en 0.00 (`loan-disbursement-terms.ts`) y ningún código lo vuelve a escribir.',
  },
  {
    claim: 'se suspenden las compras',
    pattern: /suspende\s+la\s+posibilidad|(?:suspend|bloque)\w*[^.]{0,40}compras|restricciones\s+de\s+compra/i,
    why: 'La admisión de solicitudes no mira la mora (`submit-credit-application.use-case.ts`); la mora sólo pesa en el historial de pago y en el recálculo del límite.',
  },
  {
    claim: 'reporte a una central de riesgo',
    pattern: /central\s+de\s+informaci[oó]n\s+crediticia|\bCIC\b|se\s+reporta|reporte\s+negativo|bur[oó]\s+de\s+cr[eé]dito/i,
    why: 'No hay ningún código que reporte a una central de riesgo o buró.',
  },
  {
    claim: 'el caso pasa a cobranza',
    pattern: /pasa\s+a\s+cobranza/i,
    why: 'Ningún proceso traspasa automáticamente un préstamo en mora a cobranza.',
  },
];

/** Los textos de una versión que llegan al cliente. */
export type PublishedPolicyText = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  source?: { reference: string | null } | null;
  stages: ReadonlyArray<{ label?: unknown; detail?: unknown }>;
};

export type ClaimFinding = { claim: string; why: string; excerpt: string };

function textsOf(policy: PublishedPolicyText): string[] {
  const stageTexts = policy.stages.flatMap((stage) =>
    [stage.label, stage.detail].filter((value): value is string => typeof value === 'string'),
  );
  return [policy.title, policy.summary, policy.bodyMarkdown, policy.source?.reference ?? '', ...stageTexts];
}

/** Cada afirmación no respaldada que aparece en la versión, con el fragmento donde aparece. */
export function findUnbackedClaims(policy: PublishedPolicyText): ClaimFinding[] {
  const findings: ClaimFinding[] = [];
  for (const text of textsOf(policy)) {
    // El markdown parte frases en varias líneas: se buscan sobre el texto con los saltos aplanados.
    const flat = text.replace(/\s+/g, ' ');
    for (const entry of UNBACKED_DELINQUENCY_CLAIMS) {
      const match = entry.pattern.exec(flat);
      if (match) findings.push({ claim: entry.claim, why: entry.why, excerpt: match[0] });
    }
  }
  return findings;
}
