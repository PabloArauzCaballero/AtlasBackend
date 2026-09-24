/**
 * @file Servicio de aplicación: prepara las fixtures inmutables de una corrida QA.
 * @business Esta pieza resuelve catálogos por su código natural o por consulta real, nunca con un
 *   `productId = "1"` quemado que pasa contra un catálogo que ya cambió.
 * @system se resuelven UNA vez por corrida, antes de la primera persona; una que falta bloquea.
 */
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import type { QaTransport } from './executor.ports.js';

export type ResolvedFixtures = { ok: true; fixtures: Record<string, unknown> } | { ok: false; missing: string; message: string };

export type FixtureSources = {
  transport: QaTransport;
  /** Producto activo del tenant, si el worker comparte base con el destino; `null` si no. */
  creditProduct: () => Promise<{ id: string; minAmount: number; maxAmount: number } | null>;
  signal: AbortSignal;
};

export async function resolveFixtures(template: JourneyTemplate, sources: FixtureSources): Promise<ResolvedFixtures> {
  const fixtures: Record<string, unknown> = {};
  for (const fixture of template.fixtures) {
    if (fixture === 'consents') {
      const response = await sources.transport.send({
        method: 'GET',
        path: '/consent-documents/active',
        headers: {},
        timeoutMs: 10_000,
        signal: sources.signal,
      });
      const documents =
        response.status === 200 ? ((response.body as { data?: Array<{ id?: unknown; documentCode?: unknown }> })?.data ?? []) : [];
      if (documents.length === 0) {
        return {
          ok: false,
          missing: 'consents',
          message: `El catálogo de consentimientos no respondió o vino vacío (HTTP ${response.status ?? 'sin respuesta'}): nadie podría darse de alta.`,
        };
      }
      fixtures.signupConsents = documents.map((document) => ({
        consentDocumentId: String(document.id),
        purposeCode: String(document.documentCode),
        granted: true,
      }));
    }
    if (fixture === 'creditProduct') {
      const product = await sources.creditProduct();
      if (!product) {
        return {
          ok: false,
          missing: 'creditProduct',
          message: 'No hay un producto de crédito activo resoluble para el tenant; la solicitud no tendría un producto real.',
        };
      }
      fixtures.creditProductId = product.id;
      fixtures.creditProduct = product;
    }
    if (fixture === 'internalActor' || fixture === 'merchantActor') {
      return {
        ok: false,
        missing: fixture,
        message: `No hay un actor ${fixture === 'internalActor' ? 'interno' : 'de comercio'} provisionado para QA.`,
      };
    }
  }
  return { ok: true, fixtures };
}

/** Monto pedido coherente con el ingreso y dentro de los límites del producto resuelto. */
export function requestedAmountFor(monthlyIncome: number, product: { minAmount: number; maxAmount: number } | undefined): number {
  const wanted = Math.round(monthlyIncome * 2);
  const min = product?.minAmount ?? 500;
  const max = product?.maxAmount ?? 20_000;
  return Math.min(max, Math.max(min, wanted));
}
