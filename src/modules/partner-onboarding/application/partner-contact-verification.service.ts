/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system emite y comprueba el código de un solo uso que prueba el contacto declarado por el comercio.
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../../config/env.js';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { generateNumericCode, hashOneTimeCode, verifyOneTimeCode } from '../../../common/utils/crypto/one-time-code.util.js';
import { MailSenderService } from '../../mail-sender/mail-sender.service.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { PartnerProfileService } from './partner-profile.service.js';

/** Un código nuevo cada 30 s como máximo. Igual que en el onboarding del consumidor. */
const RESEND_COOLDOWN_MS = 30_000;

/**
 * Cuántas veces se puede fallar antes de invalidar el código.
 *
 * Es la mitad que se olvida al copiar este patrón: el TTL por sí solo no protege nada, porque un
 * millón de combinaciones de seis dígitos caben de sobra dentro de diez minutos. Lo que hace que
 * el código valga es que se agote.
 */
const MAX_ATTEMPTS = 5;

/**
 * Prueba que el comercio controla el correo que declaró.
 *
 * Es el eslabón que faltaba: `email_verified_at` existía en el esquema desde el principio y nada
 * lo escribía, así que el expediente distinguía el contacto DECLARADO del PROBADO sin poder probar
 * ninguno. Declarar un correo no cuesta nada; recibir en él, sí.
 */
@Injectable()
export class PartnerContactVerificationService {
  private readonly logger = new Logger(PartnerContactVerificationService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly repository: PartnerOnboardingRepository,
    private readonly profiles: PartnerProfileService,
    private readonly mail: MailSenderService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Emite el código y lo manda al correo declarado.
   *
   * El código se guarda HASHEADO: quien lea la base no puede verificar por él. Y se manda al
   * correo que está en el expediente, nunca a uno que venga en la petición — si el destino
   * viajara en el cuerpo, esto no probaría nada: cualquiera pediría el código a su propio buzón.
   */
  async request(tenantId: string, partnerId: string): Promise<{ sent: boolean; expiresInMinutes: number }> {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    this.profiles.assertEditable(profile);

    if (profile.emailVerifiedAt) {
      throw new ConflictException('PARTNER_CONTACT_ALREADY_VERIFIED');
    }
    const sentAt = profile.contactCodeSentAt?.getTime() ?? 0;
    if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
      throw new ConflictException('PARTNER_VERIFICATION_RATE_LIMITED');
    }
    if (!this.mail.isEnabled()) {
      // Sin canal de correo no hay verificación posible, y fingir que se envió dejaría al comercio
      // esperando un mensaje que nadie mandó.
      throw new UnprocessableEntityException('MAIL_CHANNEL_NOT_AVAILABLE');
    }

    const ttlMinutes = env.AUTH_ONE_TIME_CODE_TTL_MINUTES;
    const code = generateNumericCode(6);
    await this.repository.updateProfile(profile, {
      contactCodeHash: hashOneTimeCode(code),
      contactCodeExpiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      // Los intentos se reinician con cada código: se gastan contra el código, no contra el correo.
      contactCodeAttempts: 0,
      contactCodeSentAt: new Date(),
    });

    await this.mail.sendContactVerificationCode({
      to: profile.contactEmail,
      code,
      ttlMinutes,
      reference: `partner-contact-${partnerId}`,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'contact_verification_sent', outcome: 'ok' });
    // Ni el código ni el correo se registran: uno abre la puerta y el otro es dato de contacto.
    this.logger.log(`Código de verificación de contacto emitido: partnerId=${partnerId}`);
    return { sent: true, expiresInMinutes: ttlMinutes };
  }

  /**
   * Comprueba el código y marca el contacto como probado.
   *
   * Un código válido se consume aunque el expediente siga adelante: dejarlo vivo permitiría
   * reutilizarlo, y «un solo uso» dejaría de ser cierto.
   */
  async submit(tenantId: string, partnerId: string, candidate: string): Promise<{ verified: true }> {
    /*
     * Todo el canje ocurre dentro de UNA transacción con la fila del expediente bloqueada.
     *
     * Leer el contador de intentos, decidir con él y escribirlo son tres operaciones, y sin el
     * bloqueo no forman una sola: dos peticiones simultáneas leían el mismo valor, las dos pasaban
     * el control de intentos agotados y las dos escribían el mismo resultado. El límite se
     * esquivaba entero probando códigos en paralelo — que es exactamente contra lo que existe—, y
     * un código de un solo uso podía consumirse dos veces.
     *
     * `FOR UPDATE` serializa por expediente, no globalmente: dos comercios distintos no se esperan.
     */
    return this.sequelize.transaction(async (transaction) => {
      const profile = await this.repository.lockProfileById(tenantId, partnerId, transaction);
      if (!profile) throw new NotFoundException('El expediente del partner no existe.');
      this.profiles.assertEditable(profile);

      if (profile.emailVerifiedAt) return { verified: true };
      if (!profile.contactCodeHash || !profile.contactCodeExpiresAt) {
        throw new UnprocessableEntityException('PARTNER_VERIFICATION_NOT_REQUESTED');
      }
      if (profile.contactCodeExpiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('PARTNER_VERIFICATION_CODE_EXPIRED');
      }
      if (profile.contactCodeAttempts >= MAX_ATTEMPTS) {
        throw new UnauthorizedException('PARTNER_VERIFICATION_ATTEMPTS_EXHAUSTED');
      }

      if (!verifyOneTimeCode(candidate, profile.contactCodeHash)) {
        /*
         * El intento se cuenta ANTES de responder y dentro de la transacción que sostiene el
         * bloqueo: así el incremento que ve la siguiente petición es el de ésta, y no el valor
         * que leyó antes de empezar.
         */
        await this.repository.updateProfile(profile, { contactCodeAttempts: profile.contactCodeAttempts + 1 }, { transaction });
        this.metrics.recordPartnerOnboardingStep({ step: 'contact_verification', outcome: 'rejected' });
        throw new UnauthorizedException('PARTNER_VERIFICATION_CODE_INVALID');
      }

      await this.repository.updateProfile(
        profile,
        {
          emailVerifiedAt: new Date(),
          // El código se consume: un solo uso significa exactamente esto.
          contactCodeHash: null,
          contactCodeExpiresAt: null,
          contactCodeAttempts: 0,
          /*
           * El estado avanza sólo desde `draft`. Si el expediente ya estaba más adelante —porque
           * el comercio verificó su correo después de cargar documentos— retrocederlo borraría
           * avance real por haber completado un paso lateral.
           */
          ...(profile.onboardingStatus === 'draft' ? { onboardingStatus: 'contact_verified' } : {}),
        },
        { transaction },
      );

      this.metrics.recordPartnerOnboardingStep({ step: 'contact_verification', outcome: 'ok' });
      this.logger.log(`Contacto de partner verificado: partnerId=${partnerId}`);
      return { verified: true };
    });
  }
}
