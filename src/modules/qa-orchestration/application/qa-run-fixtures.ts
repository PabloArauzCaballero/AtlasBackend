/**
 * @file Servicio de aplicación: prepara las fixtures inmutables de una corrida QA.
 * @business Esta pieza resuelve catálogos por su código natural o por consulta real, nunca con un
 *   `productId = "1"` quemado que pasa contra un catálogo que ya cambió.
 * @system se resuelven UNA vez por corrida, antes de la primera persona; una que falta bloquea.
 */
import type { JourneyTemplate } from '../domain/journey-recipe.types.js';
import type { QaTransport } from './executor.ports.js';

/** `sessions` lleva las sesiones de actores compartidos (el operador QA): nunca van a fixtures ni a evidencia. */
export type ResolvedFixtures =
  | { ok: true; fixtures: Record<string, unknown>; sessions: Record<string, Record<string, unknown>> }
  | { ok: false; missing: string; message: string };

export type FixtureSources = {
  transport: QaTransport;
  /** Producto activo del tenant, si el worker comparte base con el destino; `null` si no. */
  creditProduct: () => Promise<{ id: string; minAmount: number; maxAmount: number } | null>;
  /** Sesión del operador interno QA; `null` si el entorno no lo provisionó. */
  internalActor?: () => Promise<{ ok: true; accessToken: string } | { ok: false; message: string } | null>;
  signal: AbortSignal;
};

type Resolved =
  { fixtures?: Record<string, unknown>; sessions?: Record<string, Record<string, unknown>> } | { missing: string; message: string };
type Resolver = (sources: FixtureSources) => Promise<Resolved>;

async function consents(sources: FixtureSources): Promise<Resolved> {
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
      missing: 'consents',
      message: `El catálogo de consentimientos no respondió o vino vacío (HTTP ${response.status ?? 'sin respuesta'}): nadie podría darse de alta.`,
    };
  }
  const signupConsents = documents.map((document) => ({
    consentDocumentId: String(document.id),
    purposeCode: String(document.documentCode),
    granted: true,
  }));
  return { fixtures: { signupConsents } };
}

async function creditProduct(sources: FixtureSources): Promise<Resolved> {
  const product = await sources.creditProduct();
  if (!product)
    return {
      missing: 'creditProduct',
      message: 'No hay un producto de crédito activo resoluble para el tenant; la solicitud no tendría un producto real.',
    };
  return { fixtures: { creditProductId: product.id, creditProduct: product } };
}

async function internalActor(sources: FixtureSources): Promise<Resolved> {
  const session = (await sources.internalActor?.()) ?? null;
  if (!session) return { missing: 'internalActor', message: 'No hay un actor interno provisionado para QA.' };
  if (!session.ok) return { missing: 'internalActor', message: session.message };
  return { fixtures: { internalActor: { provisioned: true } }, sessions: { internal_user: { accessToken: session.accessToken } } };
}

const RESOLVERS: Record<JourneyTemplate['fixtures'][number], Resolver> = {
  consents,
  creditProduct,
  internalActor,
  merchantActor: async () => ({ missing: 'merchantActor', message: 'No hay un actor de comercio provisionado para QA.' }),
};

export async function resolveFixtures(template: JourneyTemplate, sources: FixtureSources): Promise<ResolvedFixtures> {
  const fixtures: Record<string, unknown> = {};
  const sessions: Record<string, Record<string, unknown>> = {};
  for (const fixture of template.fixtures) {
    const resolved = await RESOLVERS[fixture](sources);
    if ('missing' in resolved) return { ok: false, ...resolved };
    Object.assign(fixtures, resolved.fixtures ?? {});
    Object.assign(sessions, resolved.sessions ?? {});
  }
  return { ok: true, fixtures, sessions };
}

/** Monto pedido coherente con el ingreso y dentro de los límites del producto resuelto. */
export function requestedAmountFor(monthlyIncome: number, product: { minAmount: number; maxAmount: number } | undefined): number {
  const wanted = Math.round(monthlyIncome * 2);
  const min = product?.minAmount ?? 500;
  const max = product?.maxAmount ?? 20_000;
  return Math.min(max, Math.max(min, wanted));
}
