/**
 * @file Smoke: pagar una cuota con el QR del comercio y verificar el comprobante, de punta a punta.
 * @business El cliente ve el QR APROBADO del comercio, sube su comprobante y el comercio lo confirma:
 *   ahí, y sólo ahí, se registra el pago del préstamo.
 * @system recorre instrucción → (revisión del QR si está pendiente) → ticket firmado → PUT al almacén →
 *   aviso → cola del comercio → verificación → la cuota refleja el pago. Falla en cuanto un eslabón no
 *   ocurre; ninguno se «salta con aviso».
 *
 * Necesita datos reales del entorno: un cliente con una cuota pendiente de un préstamo originado por
 * un comercio, y el usuario de comercio dueño de ese expediente.
 *
 *   CUSTOMER_ID=10 MERCHANT_USER_ID=9001 SMOKE_INSTALLMENT_ID=123 SMOKE_PARTNER_ID=7 \
 *   BASE_URL=http://localhost:53005/api/v1 yarn smoke:payment-claims
 */
import { getStringFromPaths, request, CUSTOMER_ID } from './http.js';
import { requireSmokeEnv } from './required-smoke-env.js';
import { qrPng } from '../fixtures/qr-imagen.js';

type JsonRecord = Record<string, unknown>;

function unwrap(value: JsonRecord): JsonRecord {
  const inner = value.data;
  return inner !== null && typeof inner === 'object' ? (inner as JsonRecord) : value;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/* Cada comprobante tiene que ser distinto: `evidence_documents` deduplica por hash y cliente. */
function comprobanteUnico(): Buffer {
  const base = qrPng();
  const sello = Buffer.from(`atlas-smoke-${Date.now()}-${Math.random()}`, 'utf8');
  return Buffer.concat([base, sello]);
}

async function instruccion(installmentId: string): Promise<JsonRecord> {
  const respuesta = await request<JsonRecord>({
    method: 'GET',
    path: `/mobile/customers/${CUSTOMER_ID}/payment-claims/instructions/${installmentId}`,
    role: 'customer',
    expected: [200],
  });
  return unwrap(respuesta.data);
}

/**
 * Si el QR del comercio espera revisión, lo aprueba como persona del portal interno. Es el mismo
 * camino que usa el portal; el smoke no tiene un atajo.
 */
async function asegurarQrAprobado(partnerId: string, primera: JsonRecord): Promise<JsonRecord> {
  if (primera.paymentQr) return primera;
  assert(
    primera.paymentQrUnavailableReason === 'PARTNER_PAYMENT_QR_PENDING_REVIEW',
    `el comercio ${partnerId} no tiene QR de cobro: motivo=${String(primera.paymentQrUnavailableReason)}. ` +
      'Sube uno desde el ERP (o con smoke:partner-onboarding) antes de correr este smoke.',
  );

  const pendientes = await request<JsonRecord>({
    method: 'GET',
    path: '/operations/partners/qr-codes/pending',
    role: 'admin',
    expected: [200],
  });
  const items = (unwrap(pendientes.data).items ?? []) as JsonRecord[];
  const propio = items.find((qr) => String(qr.partnerId) === partnerId && qr.qrKind === 'bank');
  assert(propio !== undefined, 'la cola de revisión no contiene el QR bancario que la instrucción dice que está pendiente');

  await request({
    method: 'POST',
    path: `/operations/partners/${partnerId}/qr-codes/${String(propio!.qrId)}/review`,
    role: 'admin',
    expected: [200],
    body: { approved: true, note: 'Aprobado por el smoke de pagos.' },
  });
  return instruccion(String(primera.installmentId));
}

export async function runPaymentClaimsSmoke(): Promise<void> {
  const installmentId = requireSmokeEnv('SMOKE_INSTALLMENT_ID');
  const partnerId = requireSmokeEnv('SMOKE_PARTNER_ID');

  // --- 1. La instrucción de pago, con el QR aprobado embebido ----------------------------------
  const primera = await instruccion(installmentId);
  assert(primera.status !== 'paid', `la cuota ${installmentId} ya está pagada; elige otra`);
  const conQr = await asegurarQrAprobado(partnerId, primera);
  const qr = conQr.paymentQr as JsonRecord | null;
  assert(qr !== null, `la instrucción sigue sin QR: motivo=${String(conQr.paymentQrUnavailableReason)}`);
  assert(String(qr!.imageDataUrl).startsWith('data:image/'), 'el QR no viaja embebido como data URL');
  assert(qr!.status === 'active', `el QR que ve el cliente tiene que estar aprobado; está en ${String(qr!.status)}`);

  // --- 2. El comprobante: ticket firmado, PUT directo al almacén, aviso ------------------------
  const comprobante = comprobanteUnico();
  const ticket = await request<JsonRecord>({
    method: 'POST',
    path: `/mobile/customers/${CUSTOMER_ID}/payment-claims/proof-tickets`,
    role: 'customer',
    expected: [201],
    body: { contentType: 'image/png', sizeBytes: comprobante.byteLength },
  });
  const ticketBody = unwrap(ticket.data);
  const uploadUrl = getStringFromPaths(ticketBody, [['uploadUrl']]);
  const storageKey = getStringFromPaths(ticketBody, [['storageKey']]);
  const requiredHeaders = (ticketBody.requiredHeaders ?? {}) as Record<string, string>;
  assert(uploadUrl.length > 0 && storageKey.length > 0, 'el ticket de subida llegó incompleto');
  assert(typeof requiredHeaders['content-length'] === 'string', 'el ticket tiene que traer `requiredHeaders` con content-length');

  const put = await fetch(uploadUrl, { method: 'PUT', headers: requiredHeaders, body: comprobante });
  assert(put.ok, `el almacén rechazó el comprobante (${put.status}): ${await put.text()}`);

  let claimId: string;
  const aviso = await request<JsonRecord>({
    method: 'POST',
    path: `/mobile/customers/${CUSTOMER_ID}/payment-claims`,
    role: 'customer',
    expected: [201, 409],
    body: {
      installmentId,
      amount: String(conQr.amountOutstanding),
      payerReference: `SMOKE-${Date.now()}`,
      storageKey,
      contentType: 'image/png',
    },
  });
  if (aviso.status === 201) {
    claimId = getStringFromPaths(unwrap(aviso.data), [['claimId']]);
  } else {
    // Ya había un aviso pendiente de esta cuota: se verifica ése. El índice único lo garantiza.
    const abierto = (conQr.openClaim ?? primera.openClaim) as JsonRecord | null;
    assert(abierto !== null && abierto.status === 'pending_verification', 'el 409 no corresponde a un aviso pendiente conocido');
    claimId = String(abierto!.claimId);
  }

  // --- 3. El comercio lo ve en su cola y lo confirma -------------------------------------------
  const cola = await request<JsonRecord>({
    method: 'GET',
    path: `/merchant/partners/${partnerId}/payment-claims?onlyPending=true`,
    role: 'merchant',
    expected: [200],
  });
  const reclamos = (unwrap(cola.data).items ?? unwrap(cola.data).claims ?? []) as JsonRecord[];
  assert(
    reclamos.some((reclamo) => String(reclamo.claimId) === claimId),
    `el aviso ${claimId} no aparece en la cola del comercio ${partnerId}: nadie lo verificaría`,
  );

  const verificacion = await request<JsonRecord>({
    method: 'POST',
    path: `/merchant/partners/${partnerId}/payment-claims/${claimId}/verification`,
    role: 'merchant',
    expected: [200],
    body: { verified: true },
  });
  const verificado = unwrap(verificacion.data);
  assert(verificado.status === 'verified', `la verificación no dejó el aviso en verified: ${JSON.stringify(verificado)}`);
  assert(Boolean(verificado.loanPaymentId), 'verificar tiene que registrar un pago del préstamo (loanPaymentId)');

  // --- 4. La cuota lo refleja ------------------------------------------------------------------
  const despues = await instruccion(installmentId);
  assert(
    Number(despues.amountOutstanding) < Number(conQr.amountOutstanding) || despues.status === 'paid',
    `la cuota no refleja el pago: antes=${String(conQr.amountOutstanding)} después=${String(despues.amountOutstanding)}`,
  );
  console.log(`[payment-claims] OK: cuota ${installmentId} · aviso ${claimId} · pago ${String(verificado.loanPaymentId)}`);
}

const esEntrada = process.argv[1]?.endsWith('payment-claims.smoke.ts') || process.argv[1]?.endsWith('payment-claims.smoke.js');
if (esEntrada) {
  runPaymentClaimsSmoke().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
