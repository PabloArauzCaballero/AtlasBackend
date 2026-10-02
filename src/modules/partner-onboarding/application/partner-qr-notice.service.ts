/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Un comercio se entera en el acto de que cambió la cuenta a la que le pagan sus clientes.
 * @system manda el aviso por correo al contacto del comercio cuando se registra un QR de cobro; nunca tumba el registro.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PartnerProfileModel, PartnerQrCodeModel } from '../../../database/models/index.js';
import { PARTNER_QR_NOTICE_MAIL, type PartnerQrNoticeMail } from './partner-qr-notice.port.js';

/**
 * La salvaguarda que sustituye a la revisión interna del QR (retirada el 2026-10-02 a pedido de
 * Pablo: «el QR lo confirma el negocio, no Atlas»). Un QR activo en el acto es cómodo para el
 * comercio honesto y peligroso si le roban el usuario: quien entre podría cambiar la cuenta de
 * cobro. El aviso al correo del contacto es lo que hace visible ese cambio sin poner a nadie de
 * Atlas en medio.
 *
 * El envío es de cortesía: si el correo no está configurado o falla, el QR ya quedó registrado y
 * se registra el fallo; no se deshace nada.
 */
@Injectable()
export class PartnerQrNoticeService {
  private readonly logger = new Logger(PartnerQrNoticeService.name);

  constructor(@Inject(PARTNER_QR_NOTICE_MAIL) private readonly mail: PartnerQrNoticeMail) {}

  async avisarCambioDeQrDeCobro(profile: PartnerProfileModel, qr: PartnerQrCodeModel): Promise<void> {
    if (qr.qrKind !== 'bank') return;
    if (!profile.contactEmail) {
      this.logger.warn(`QR de cobro cambiado sin correo de contacto al que avisar: partnerId=${profile.id}`);
      return;
    }
    if (!this.mail.isEnabled()) {
      this.logger.warn(`QR de cobro cambiado y sin canal de correo configurado: partnerId=${profile.id} qrId=${qr.id}`);
      return;
    }
    try {
      await this.mail.sendPaymentQrChanged({
        to: profile.contactEmail,
        companyName: profile.tradeName?.trim() || profile.legalName,
        bankInstitutionCode: qr.bankInstitutionCode,
        accountNumberMasked: qr.accountNumberMasked,
        registeredAt: qr.createdAtValue ?? new Date(),
        reference: `partner-qr-${qr.id}`,
      });
    } catch (error) {
      this.logger.error(`No se pudo avisar del cambio de QR de cobro: partnerId=${profile.id} qrId=${qr.id}: ${String(error)}`);
    }
  }
}
