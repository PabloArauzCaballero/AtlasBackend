/**
 * Generación de un QR de cobro de PRUEBA para BANKING_GENERIC en modo local (mock_local/sandbox).
 * Espeja al generador del mock server (`AtlasExternalProvidersMock/src/domain/test-qr.mjs`) para que
 * la respuesta sea equivalente venga del mock server o se genere en proceso. NO es un QR EMV real
 * escaneable — es data de prueba: un payload de texto + una imagen SVG "tipo QR" (data URL) que
 * renderiza en el navegador sin librerías. Determinista: mismo input ⇒ mismo QR.
 */

export type BankQrResult = {
  status: 'QR_GENERATED' | 'QR_EXPIRED';
  qrId: string;
  qrPayload: string;
  qrImageSvgDataUrl: string;
  amount: number;
  currency: string;
  reference: string;
  expiresAt: string;
  providerReference: string;
};

export type BankQrInput = {
  amount?: number;
  currency?: string;
  reference?: string;
  scenario?: string;
};

function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0xffffffff;
  };
}

const MODULES = 25;
const CELL = 8;
const QUIET = 2;

function finderModule(row: number, col: number): { finder: boolean; on: boolean } {
  const inBox = (r0: number, c0: number): boolean => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
  const finderPixel = (r0: number, c0: number): boolean => {
    const r = row - r0;
    const c = col - c0;
    const border = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    return border || core;
  };
  if (inBox(0, 0)) return { finder: true, on: finderPixel(0, 0) };
  if (inBox(0, MODULES - 7)) return { finder: true, on: finderPixel(0, MODULES - 7) };
  if (inBox(MODULES - 7, 0)) return { finder: true, on: finderPixel(MODULES - 7, 0) };
  return { finder: false, on: false };
}

function buildQrSvg(payload: string): string {
  const random = makeRandom(hash32(payload));
  const size = (MODULES + QUIET * 2) * CELL;
  let rects = '';
  for (let row = 0; row < MODULES; row += 1) {
    for (let col = 0; col < MODULES; col += 1) {
      const finder = finderModule(row, col);
      const on = finder.finder ? finder.on : random() > 0.5;
      if (on) {
        const x = (col + QUIET) * CELL;
        const y = (row + QUIET) * CELL;
        rects += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`
  );
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** Genera un QR de cobro de prueba en proceso (modo local). Determinista por input. */
export function buildTestBankQr(input: BankQrInput = {}): BankQrResult {
  const amount = typeof input.amount === 'number' && input.amount > 0 ? input.amount : 100;
  const currency = typeof input.currency === 'string' && input.currency ? input.currency : 'BOB';
  const reference = typeof input.reference === 'string' && input.reference ? input.reference : 'MOCK-REF';
  const expired = input.scenario === 'expired';
  const payload = `ATLAS-MOCK-QR|amount=${amount}|currency=${currency}|ref=${reference}`;
  const seed = hash32(payload).toString(16).toUpperCase().padStart(8, '0');
  return {
    status: expired ? 'QR_EXPIRED' : 'QR_GENERATED',
    qrId: `QR-BANK-MOCK-${seed}`,
    qrPayload: payload,
    qrImageSvgDataUrl: svgToDataUrl(buildQrSvg(payload)),
    amount,
    currency,
    reference,
    expiresAt: expired ? '2026-01-01T00:00:00Z' : '2026-12-31T23:59:59Z',
    providerReference: 'BANK-QR-MOCK-001',
  };
}

/** Mapea la respuesta del mock server (`/mock/banking/qr/generate`) al resultado tipado. */
export function mapMockQrPayload(payload: Record<string, unknown>, fallbackInput: BankQrInput = {}): BankQrResult {
  const local = buildTestBankQr(fallbackInput);
  const str = (value: unknown, fallback: string): string => (typeof value === 'string' && value ? value : fallback);
  const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const status = payload.status === 'QR_EXPIRED' ? 'QR_EXPIRED' : 'QR_GENERATED';
  return {
    status,
    qrId: str(payload.qrId, local.qrId),
    qrPayload: str(payload.qrPayload, local.qrPayload),
    qrImageSvgDataUrl: str(payload.qrImageSvgDataUrl, local.qrImageSvgDataUrl),
    amount: num(payload.amount, local.amount),
    currency: str(payload.currency, local.currency),
    reference: str(payload.reference, local.reference),
    expiresAt: str(payload.expiresAt, local.expiresAt),
    providerReference: str(payload.providerReference, local.providerReference),
  };
}
