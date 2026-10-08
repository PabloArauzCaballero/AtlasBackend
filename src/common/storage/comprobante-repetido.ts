/**
 * @file Regla de negocio: un comprobante de pago no puede ser una imagen que el cliente ya subió.
 * @business El cliente entiende qué hacer («elige la captura de ESTE pago») en vez de un error de base de datos.
 * @system lo comparten el aviso de una cuota y el del pago inicial, antes de guardar la evidencia.
 */
import { ConflictException } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import type { EvidenceDocumentModel } from '../../database/models/index.js';

export const PAYMENT_PROOF_ALREADY_USED = 'PAYMENT_PROOF_ALREADY_USED';

/**
 * Rechaza un comprobante idéntico, byte a byte, a cualquier evidencia previa del mismo cliente.
 *
 * El índice único `ux_evidence_documents_customer_hash` ya lo impedía, pero como violación de
 * constraint: el filtro global la convertía en «El recurso ya existe o viola una restricción única»
 * y la app lo mostraba tal cual (2026-10-08, TestFlight build 46: Pablo eligió como comprobante la
 * misma captura que subió en el alta como QR de su banco). Se comprueba ANTES de escribir para dar
 * un código propio y una frase que diga qué hacer. Una imagen repetida tampoco puede ser la prueba
 * de un pago nuevo: el mismo recibo no salda dos pagos.
 */
export async function assertComprobanteNoRepetido(
  evidences: typeof EvidenceDocumentModel,
  input: { tenantId: string; customerId: string; sha256Hex: string; transaction?: Transaction },
): Promise<void> {
  const previa = await evidences.findOne({
    where: { tenantId: input.tenantId, customerId: input.customerId, fileHashSha256: input.sha256Hex },
    transaction: input.transaction,
  });
  if (previa) {
    throw new ConflictException({
      code: PAYMENT_PROOF_ALREADY_USED,
      message: 'Esa imagen ya la subiste antes en Atlas. Elige la captura o la foto del comprobante de este pago.',
    });
  }
}
