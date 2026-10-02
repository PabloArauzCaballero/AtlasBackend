import { describe, expect, it, jest } from '@jest/globals';
import { PartnerQrNoticeService } from '../../../src/modules/partner-onboarding/application/partner-qr-notice.service.js';

/**
 * Desde el 2026-10-02 el QR de cobro no lo revisa Atlas: lo confirma el comercio y queda activo. La
 * salvaguarda es este aviso al contacto del comercio. Es de cortesía: nunca tumba el registro.
 */
describe('PartnerQrNoticeService', () => {
  const perfil = { id: '7', legalName: 'Multicenter S.R.L.', tradeName: 'Multicenter', contactEmail: 'cobros@ejemplo.bo' };
  const qr = {
    id: '99',
    qrKind: 'bank',
    bankInstitutionCode: 'BNB',
    accountNumberMasked: '****0739',
    createdAtValue: new Date('2026-10-02T12:17:39Z'),
  };

  function build(opts: { enabled?: boolean; falla?: boolean } = {}) {
    const mail = {
      isEnabled: () => opts.enabled ?? true,
      sendPaymentQrChanged: jest.fn(async (..._args: unknown[]) => {
        if (opts.falla) throw new Error('smtp caído');
        return { trackingId: 't' };
      }),
    };
    return { mail, service: new PartnerQrNoticeService(mail as never) };
  }

  it('avisa al correo de contacto con empresa, entidad, cuenta enmascarada y fecha', async () => {
    const { service, mail } = build();
    await service.avisarCambioDeQrDeCobro(perfil as never, qr as never);
    expect(mail.sendPaymentQrChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'cobros@ejemplo.bo',
        companyName: 'Multicenter',
        bankInstitutionCode: 'BNB',
        accountNumberMasked: '****0739',
        reference: 'partner-qr-99',
      }),
    );
  });

  it('el QR del negocio (no bancario) no avisa: no dice a qué cuenta va el dinero', async () => {
    const { service, mail } = build();
    await service.avisarCambioDeQrDeCobro(perfil as never, { ...qr, qrKind: 'business' } as never);
    expect(mail.sendPaymentQrChanged).not.toHaveBeenCalled();
  });

  it('sin canal de correo o con el envío roto, el registro NO se deshace: sólo se registra', async () => {
    const sinCanal = build({ enabled: false });
    await expect(sinCanal.service.avisarCambioDeQrDeCobro(perfil as never, qr as never)).resolves.toBeUndefined();
    expect(sinCanal.mail.sendPaymentQrChanged).not.toHaveBeenCalled();

    const roto = build({ falla: true });
    await expect(roto.service.avisarCambioDeQrDeCobro(perfil as never, qr as never)).resolves.toBeUndefined();
  });
});
