/**
 * @file Servicio de aplicación: el contexto con el que una persona recorre su receta.
 * @business Esta pieza reconstruye a la persona desde semilla + ordinal + namespace, con lo que ya
 *   obtuvo (checkpoint) y las sesiones compartidas del operador QA, sin compartir la suya.
 * @system puro salvo la hora de arranque; la sesión de cada actor es una copia por persona.
 */
import { createHash } from 'node:crypto';
import { buildPersona } from '../domain/persona-factory.js';
import type { PersonaCheckpoint } from '../infrastructure/qa-run-worker.repository.js';
import type { RunContext } from './qa-run-closing.js';
import type { Runtime } from './qa-run-execution.service.js';
import { requestedAmountFor } from './qa-run-fixtures.js';

export function personaScope(ctx: RunContext, runtime: Pick<Runtime, 'fixtures' | 'sessions'>, checkpoint: PersonaCheckpoint) {
  const refDate = new Date(`${ctx.referenceDate}T12:00:00Z`);
  const persona = buildPersona({ masterSeed: ctx.seed, ordinal: checkpoint.ordinal, refDate, runNamespace: ctx.namespace });
  const product = runtime.fixtures.creditProduct as { minAmount: number; maxAmount: number } | undefined;
  return {
    persona,
    scope: {
      persona: {
        ...persona,
        requestedAmount: requestedAmountFor(persona.monthlyIncome, product),
        // Lo que la app manda en lugar del número en claro: hash del documento y sus últimos 4.
        documentNumberHash: createHash('sha256').update(persona.documentNumber).digest('hex'),
        documentLast4: persona.documentNumber.slice(-4),
      },
      fixtures: runtime.fixtures,
      run: {
        runId: ctx.runId,
        namespace: ctx.namespace,
        seed: ctx.seed,
        referenceDate: ctx.referenceDate,
        scenarioCode: ctx.plan.scenarioCode,
        // Marca de tiempo del arranque de la persona (ISO con Z, lo que exigen los Zod de captura).
        nowIso: new Date().toISOString(),
        // Sufijo corto del namespace para identificadores únicos que la persona no trae de serie.
        nonce: createHash('sha256').update(ctx.namespace).digest('hex').slice(0, 8),
      },
      resources: { ...checkpoint.resources } as Record<string, unknown>,
      session: Object.fromEntries(Object.entries(runtime.sessions).map(([actor, value]) => [actor, { ...value }])) as Record<
        string,
        Record<string, unknown>
      >,
    },
  };
}
