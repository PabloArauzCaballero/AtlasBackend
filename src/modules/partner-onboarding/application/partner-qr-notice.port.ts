/**
 * @file Puerto de salida: lo que este módulo necesita de otro, sin depender de su implementación.
 * @business Un comercio se entera en el acto de que cambió la cuenta a la que le pagan sus clientes.
 * @system el remitente del aviso lo inyecta el módulo (hoy `MailSenderService`); aquí sólo se declara la forma.
 */

/** Token de inyección: el módulo lo resuelve con `useExisting: MailSenderService`. */
export const PARTNER_QR_NOTICE_MAIL = Symbol('PARTNER_QR_NOTICE_MAIL');

/**
 * Lo mínimo que hace falta para avisar. Es un subconjunto estructural de `MailSenderService`, y se
 * declara aquí —y no se importa aquélla— porque las fronteras de módulos (`check:architecture`)
 * no permiten que `partner-onboarding` dependa de `mail-sender`: la única excepción es deuda
 * congelada en la línea base y no se amplía.
 */
export interface PartnerQrNoticeMail {
  isEnabled(): boolean;
  sendPaymentQrChanged(input: {
    to: string;
    companyName: string;
    bankInstitutionCode: string | null;
    accountNumberMasked: string | null;
    registeredAt: Date;
    reference: string;
  }): Promise<{ trackingId: string }>;
}
