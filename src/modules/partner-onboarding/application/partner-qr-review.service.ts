/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Una persona aprueba el QR de cobro de un comercio antes de que un cliente transfiera contra él.
 * @system revisa un QR en `pending_review`: aprobar lo activa y archiva el activo anterior; rechazar exige nota.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { PartnerQrCodeModel } from '../../../database/models/index.js';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { ReviewQrDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileService } from './partner-profile.service.js';

/**
 * La revisión del QR de cobro.
 *
 * Hasta el 2026-09-14 no existía: todo QR nacía en `pending_review`, nadie lo sacaba de ahí, y la
 * app del cliente lo enseñaba igual. Un QR de cobro dice a qué cuenta va el dinero de otra
 * persona; por eso lo mira alguien antes de que un cliente lo vea, y por eso la fila conserva quién
 * lo firmó y qué nota dejó.
 */
@Injectable()
export class PartnerQrReviewService {
  private readonly logger = new Logger(PartnerQrReviewService.name);

  constructor(
    private readonly network: PartnerCommercialNetworkRepository,
    private readonly profiles: PartnerProfileService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Aprobar lo pasa a `active` y archiva como `replaced` el que estuviera activo en el mismo ámbito
   * —en ese orden, para que nunca haya dos activos a la vez (el índice único parcial lo impediría) ni
   * un hueco sin ninguno—. Rechazar exige nota: es lo único que le dice al comercio qué corregir.
   *
   * Sólo se revisa lo que está `pending_review`. Volver a revisar un QR ya decidido responde 409:
   * un QR aprobado que alguien quiera retirar se reemplaza con otro, no se «des-aprueba», porque los
   * cobros que ya se hicieron contra él tienen que seguir siendo explicables.
   */
  async review(
    tenantId: string,
    partnerId: string,
    qrId: string,
    dto: ReviewQrDto & { internalUserId: string | null },
  ): Promise<PartnerQrCodeModel> {
    await this.profiles.requireProfile(tenantId, partnerId);
    const qr = await this.network.findQrById(tenantId, partnerId, qrId);
    if (!qr) throw new NotFoundException('QR_NOT_FOUND');
    if (qr.status !== 'pending_review') {
      throw new ConflictException(`QR_NOT_PENDING_REVIEW: el QR ${qrId} está en «${qr.status}» y no admite revisión.`);
    }

    if (dto.approved) {
      const activo = await this.network.findActiveQr(tenantId, partnerId, qr.qrKind, qr.branchId);
      if (activo && String(activo.id) !== String(qr.id)) await this.network.markQrReplaced(activo, qr.id);
    }

    const reviewed = await this.network.markQrReviewed(qr, {
      status: dto.approved ? 'active' : 'rejected',
      reviewedByInternalUserId: dto.internalUserId,
      reviewNote: dto.note ?? null,
    });

    this.metrics.recordPartnerOnboardingStep({ step: `qr_${qr.qrKind}_review`, outcome: dto.approved ? 'ok' : 'rejected' });
    this.logger.log(
      `QR de partner revisado: partnerId=${partnerId} qrId=${qrId} tipo=${qr.qrKind} resultado=${reviewed.status} ` +
        `actor=${dto.internalUserId ?? 'sin-usuario-interno'}`,
    );
    return reviewed;
  }

  /** La cola de revisión: todos los QR del tenant que esperan a una persona, el más antiguo primero. */
  listPendingReview(tenantId: string): Promise<PartnerQrCodeModel[]> {
    return this.network.listQrCodesPendingReview(tenantId);
  }
}
