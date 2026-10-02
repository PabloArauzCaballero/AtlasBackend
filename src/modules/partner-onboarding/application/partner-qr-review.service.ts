/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Una persona aprueba el QR de cobro de un comercio antes de que un cliente transfiera contra él.
 * @system revisa un QR en `pending_review`: aprobar lo activa y archiva el activo anterior; rechazar exige nota.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { buildPaginationMeta } from '../../../common/utils/pagination/pagination.util.js';
import { PartnerQrCodeModel } from '../../../database/models/index.js';
import { toPartnerQrDto } from '../partner-onboarding.mapper.js';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { PartnerQrReviewRepository } from '../partner-qr-review.repository.js';
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
    private readonly queue: PartnerQrReviewRepository,
    private readonly profiles: PartnerProfileService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Desde el 2026-10-02 el QR nace activo (lo confirma el comercio; ver `PartnerQrService`), así
   * que esta ruta ya no es la puerta: es la REVOCACIÓN. Rechazar un QR `active` lo pasa a
   * `rejected` con la nota que explica el motivo (un fraude detectado, una cuenta que no es del
   * comercio), y el comercio se queda sin QR vigente hasta subir otro. Aprobar sigue existiendo
   * para los QR que quedaron en `pending_review` antes del cambio: los activa y archiva como
   * `replaced` el que estuviera activo en el mismo ámbito —en ese orden, para que nunca haya dos
   * activos a la vez (el índice único parcial lo impediría)—.
   *
   * Un QR ya `rejected` o `replaced` no admite revisión: 409. Los cobros que se hicieron contra él
   * tienen que seguir siendo explicables, y una fila archivada no vuelve a la vida.
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
    const revocable = qr.status === 'active' && !dto.approved;
    if (qr.status !== 'pending_review' && !revocable) {
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

  /**
   * Una página de la cola de QR por revisar, cada uno con su comercio y su sucursal.
   *
   * Antes devolvía TODOS los pendientes y resolvía los comercios de uno en uno y en serie
   * (`requireProfile` en un bucle): la cola crecía y la pantalla tardaba más con cada QR subido.
   * Ahora es una página, sus comercios y sucursales salen en una consulta cada uno, `meta` es el
   * total del filtro y `summary` el de TODA la cola (por tipo y el más antiguo), para que las cifras
   * no cambien al buscar.
   */
  async listPendingReview(tenantId: string, query: { page: number; limit: number; q?: string; qrKind?: string }) {
    const text = query.q?.trim();
    const search = text
      ? {
          q: text,
          partnerIds: await this.profiles.findIdsMatching(tenantId, text),
          branchIds: await this.queue.findBranchIdsMatching(tenantId, text),
        }
      : undefined;
    const [{ rows, count }, summary] = await Promise.all([
      this.queue.listQrCodesPendingReview(tenantId, {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        qrKind: query.qrKind,
        search,
      }),
      this.queue.summarizeQrPendingReview(tenantId),
    ]);
    const [perfiles, sucursales] = await Promise.all([
      this.profiles.findManyByIds(
        tenantId,
        rows.map((qr) => String(qr.partnerProfileId)),
      ),
      this.queue.findBranchesByIds(
        tenantId,
        rows.flatMap((qr) => (qr.branchId ? [String(qr.branchId)] : [])),
      ),
    ]);
    const porId = new Map(perfiles.map((perfil) => [String(perfil.id), perfil]));
    const sucursalPorId = new Map(sucursales.map((sucursal) => [String(sucursal.id), sucursal]));
    return {
      items: rows.map((qr) => {
        const perfil = porId.get(String(qr.partnerProfileId));
        const sucursal = qr.branchId ? sucursalPorId.get(String(qr.branchId)) : undefined;
        return {
          ...toPartnerQrDto(qr),
          partnerId: String(qr.partnerProfileId),
          partner: perfil
            ? {
                legalName: perfil.legalName ?? null,
                tradeName: perfil.tradeName ?? null,
                taxId: perfil.taxId ?? null,
                onboardingStatus: perfil.onboardingStatus,
              }
            : null,
          branch: sucursal ? { branchCode: sucursal.branchCode, name: sucursal.name, city: sucursal.city ?? null } : null,
        };
      }),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, count),
      summary,
    };
  }
}
