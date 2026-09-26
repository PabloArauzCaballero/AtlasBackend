/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system dispara la evaluación de riesgo del onboarding al enviar el paquete, con el dispositivo que el cliente usó.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CustomerDeviceLinkModel } from '../../../database/models/index.js';

/** Token del puerto de riesgo: el onboarding no importa el módulo de riesgo, lo recibe por inyección. */
export const ONBOARDING_RISK_PORT = Symbol('ONBOARDING_RISK_PORT');

/**
 * Lo único que el onboarding necesita del riesgo: pedir una evaluación. `RiskService` lo implementa
 * y la composición (`customer-onboarding.module.ts`) lo enlaza; así el contexto de onboarding no
 * depende del de riesgo (`check:architecture`) y la evaluación se puede doblar sin arrastrar su modelo.
 */
export interface OnboardingRiskPort {
  createRiskAssessment(input: {
    tenantId: string;
    customerId: string;
    body: { assessmentType: 'onboarding_initial'; channel: 'system'; deviceId?: string };
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }): Promise<unknown>;
}

/**
 * Dispara la evaluación de riesgo del onboarding.
 *
 * Sale de `CustomerOnboardingStatusService` —que ya estaba en el tope del gate de tamaño— al añadir
 * el dispositivo (C-6). Se degrada con un bloqueador en vez de tumbar el envío: si el motor de
 * políticas no responde, el paquete igual queda enviado y la elegibilidad lo reporta como
 * `RISK_NOT_APPROVED` —que es la verdad— hasta que la evaluación se rehaga. Perder el envío completo
 * por una caída del motor obligaría al cliente a repetir todo el recorrido por un problema que no
 * es suyo.
 *
 * ## El dispositivo
 *
 * El envío no traía `deviceId`, así que `hasDevice` era `false` para todos y `device_score` valía
 * 55 siempre: una dimensión del modelo que no medía nada. Se resuelve en el SERVIDOR, del vínculo
 * cliente–dispositivo que el alta ya escribió al abrir sesión, y no de un campo del cuerpo: un
 * `deviceId` que llegara del cliente habría que validarlo contra sus vínculos —cualquiera podría
 * declarar un dispositivo ajeno para subir su puntaje—, y el servidor ya sabe cuál fue. Sin vínculo
 * activo el puntaje sigue siendo el de «dispositivo desconocido», que es la verdad.
 */
@Injectable()
export class OnboardingRiskTriggerService {
  private readonly logger = new Logger(OnboardingRiskTriggerService.name);

  constructor(
    @Inject(ONBOARDING_RISK_PORT) private readonly riskService: OnboardingRiskPort,
    @InjectModel(CustomerDeviceLinkModel) private readonly deviceLinks: typeof CustomerDeviceLinkModel,
  ) {}

  async run(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser; idempotencyKey: string }): Promise<void> {
    try {
      const deviceId = await this.linkedDeviceId(input.tenantId, input.customerId);
      await this.riskService.createRiskAssessment({
        tenantId: input.tenantId,
        customerId: input.customerId,
        body: { assessmentType: 'onboarding_initial', channel: 'system', ...(deviceId ? { deviceId } : {}) },
        currentUser: input.currentUser,
        // Clave derivada: el envío y su evaluación de riesgo son operaciones distintas y no pueden
        // compartir la misma entrada en `idempotency_keys`.
        idempotencyKey: `${input.idempotencyKey}:onboarding-risk`,
      });
    } catch (error) {
      this.logger.warn(
        `Envío a revisión del cliente ${input.customerId} registrado, pero la evaluación de riesgo falló: ${
          error instanceof Error ? error.message : 'error desconocido'
        }. La habilitación queda bloqueada por RISK_NOT_APPROVED hasta que se recalcule.`,
      );
    }
  }

  /**
   * El dispositivo activo más recientemente visto del cliente, o `null`.
   *
   * De mejor esfuerzo: que la consulta falle no puede costar la evaluación entera, sólo el dato de
   * dispositivo, que entonces cuenta como desconocido.
   */
  private async linkedDeviceId(tenantId: string, customerId: string): Promise<string | null> {
    try {
      const link = await this.deviceLinks.findOne({
        where: { tenantId, customerId, linkStatus: 'active', deviceId: { [Op.ne]: null }, deleted: { [Op.ne]: true } },
        order: [
          ['lastSeenAt', 'DESC NULLS LAST'],
          ['id', 'DESC'],
        ],
      } as FindOptions);
      return link?.deviceId ? String(link.deviceId) : null;
    } catch (error) {
      this.logger.warn(`No se pudo leer el dispositivo del cliente ${customerId}: ${(error as Error).message}`);
      return null;
    }
  }
}
