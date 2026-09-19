/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';

type JournalContext = {
  tenantId: string;
  customerId: string;
  contactType: string;
  sessionId: string | null;
  ipAddress: string | null;
  actorRole: string;
  actorInternalUserId: string | null;
  idempotencyKey: string;
  now: Date;
  transaction: Transaction;
};

/**
 * Bitácora de la verificación de contacto: paso del flujo, evento de autenticación, acción del
 * cliente y auditoría operativa.
 *
 * Se extrae de `CustomerContactVerificationService` porque son cuatro escrituras de registro que se
 * repiten casi idénticas en las tres salidas del flujo (solicitud, fallo, éxito) y que no contienen
 * ninguna decisión de negocio. Sacarlas deja el servicio principal en lo que realmente decide, y
 * mantiene ambos archivos por debajo del límite del gate de tamaño del repositorio.
 */
@Injectable()
export class ContactVerificationJournalService {
  constructor(private readonly onboardingRepository: CustomerOnboardingRepository) {}

  /**
   * `delivered` ya no se registra aquí: la entrega ocurre DESPUÉS del commit (ver
   * `ContactVerificationCodeService.deliverIssuedCode`), así que en este punto todavía no se sabe.
   * El resultado real vive en `verification_status` del intento, que es donde se consulta.
   */
  async recordRequested(
    context: JournalContext,
    values: { verificationChannel: string; attemptId: string; contactMethodId: string },
  ): Promise<void> {
    const flow = await this.onboardingRepository.findLatestOnboardingFlow(context.tenantId, context.customerId, {
      transaction: context.transaction,
    });
    await this.onboardingRepository.createOnboardingStepEvent(
      {
        tenantId: context.tenantId,
        onboardingFlowId: flow ? String(flow.id) : null,
        stepCode: 'contact_verification_requested',
        eventType: 'requested',
        happenedAt: context.now,
        payloadJson: {
          contactType: context.contactType,
          verificationChannel: values.verificationChannel,
          contactMethodId: values.contactMethodId,
        },
      },
      { transaction: context.transaction },
    );
    await this.recordAuthEvent(context, { eventType: 'contact_verification_requested', successful: null, failureReasonCode: null });
    await this.recordActionLog(context, { eventName: 'contact_verification_requested' });
    await this.recordAudit(context, {
      actionCode: 'customer_onboarding.contact_verification.request',
      payload: { contactType: context.contactType, attemptId: values.attemptId, contactMethodId: values.contactMethodId },
    });
  }

  async recordFailure(context: JournalContext, values: { failureReasonCode: string }): Promise<void> {
    await this.recordAuthEvent(context, {
      eventType: 'contact_verification_failed',
      successful: false,
      failureReasonCode: values.failureReasonCode,
    });
  }

  async recordVerified(context: JournalContext, values: { attemptId: string }): Promise<void> {
    const flow = await this.onboardingRepository.findLatestOnboardingFlow(context.tenantId, context.customerId, {
      transaction: context.transaction,
    });
    await this.onboardingRepository.createOnboardingStepEvent(
      {
        tenantId: context.tenantId,
        onboardingFlowId: flow ? String(flow.id) : null,
        stepCode: 'contact_verified',
        eventType: 'completed',
        happenedAt: context.now,
        payloadJson: { contactType: context.contactType },
      },
      { transaction: context.transaction },
    );
    await this.recordAuthEvent(context, { eventType: 'contact_verification_succeeded', successful: true, failureReasonCode: null });
    await this.recordActionLog(context, { eventName: 'contact_verified' });
    await this.recordAudit(context, {
      actionCode: 'customer_onboarding.contact_verification.submit',
      payload: { contactType: context.contactType, attemptId: values.attemptId },
    });
  }

  private recordAuthEvent(
    context: JournalContext,
    values: { eventType: string; successful: boolean | null; failureReasonCode: string | null },
  ): Promise<unknown> {
    return this.onboardingRepository.createAuthEvent(
      {
        tenantId: context.tenantId,
        customerId: context.customerId,
        sessionId: context.sessionId,
        deviceId: null,
        eventType: values.eventType,
        loginSuccessful: values.successful,
        failureReasonCode: values.failureReasonCode,
        occurredAt: context.now,
        ipAddress: context.ipAddress,
      },
      { transaction: context.transaction },
    );
  }

  private recordActionLog(context: JournalContext, values: { eventName: string }): Promise<unknown> {
    return this.onboardingRepository.createCustomerActionLog(
      {
        tenantId: context.tenantId,
        customerId: context.customerId,
        sessionId: context.sessionId,
        deviceId: null,
        eventName: values.eventName,
        screenName: 'contact_verification',
        // Solo el hash de la clave de idempotencia: el valor en claro identifica el request.
        payloadJson: { contactType: context.contactType, idempotencyKeyHash: sha256Hex(context.idempotencyKey) },
        occurredAt: context.now,
      },
      { transaction: context.transaction },
    );
  }

  private recordAudit(context: JournalContext, values: { actionCode: string; payload: Record<string, unknown> }): Promise<unknown> {
    return this.onboardingRepository.createOperationalAuditLog(
      {
        tenantId: context.tenantId,
        actorType: context.actorRole,
        actorInternalUserId: context.actorInternalUserId,
        actionCode: values.actionCode,
        targetType: 'customer',
        targetId: context.customerId,
        ipAddress: context.ipAddress,
        userAgent: null,
        payloadJson: values.payload,
        occurredAt: context.now,
      },
      { transaction: context.transaction },
    );
  }
}
