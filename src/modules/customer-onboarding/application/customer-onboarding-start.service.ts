/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { LegacyOnboardingAtomicBridge } from '../../../bootstrap/legacy-onboarding-atomic.bridge.js';
import { AuthTokenIssuerService } from '../../auth/auth-token-issuer.service.js';
import { StartOnboardingResponseDto } from '../customer-onboarding.dtos.js';
import { toStartOnboardingResponse } from '../customer-onboarding.mapper.js';
import { StartOnboardingDto } from '../customer-onboarding.schemas.js';
import { isApplicationError, toHttpException } from '../../../platform/contracts/application-error.js';
import { CustomerOnboardingGuardsService } from './customer-onboarding-guards.service.js';
import { OnboardingCustomerRecordService } from './onboarding-customer-record.service.js';
import { OnboardingDeviceSessionService } from './onboarding-device-session.service.js';
import { OnboardingRegistrationTrailService } from './onboarding-registration-trail.service.js';
import type { RegistrationCommand, RegistrationResult } from './ports/onboarding-registration.port.js';
import { buildStartOnboardingUseCase } from './use-cases/start-onboarding.use-case.js';

@Injectable()
export class CustomerOnboardingStartService {
  constructor(
    private readonly customerRecord: OnboardingCustomerRecordService,
    private readonly registrationTrail: OnboardingRegistrationTrailService,
    private readonly tokenIssuer: AuthTokenIssuerService,
    private readonly guardsService: CustomerOnboardingGuardsService,
    // Dispositivo, sesión y su instantánea: tres pasos que solo hablan con los repositorios de sesiones y
    // que no comparten nada con el resto del alta salvo el cliente recién creado.
    private readonly deviceSession: OnboardingDeviceSessionService,
    private readonly bridge: LegacyOnboardingAtomicBridge,
  ) {}

  /**
   * Punto de entrada transaccional de onboarding.
   *
   * Cada paso privado encapsula una escritura o validación del flujo, manteniendo una única
   * transacción para cliente, credenciales, perfil, dispositivo, sesión, permisos y consentimientos.
   *
   * La garantía de integridad real la dan los índices únicos parciales de la base de datos. El
   * `try/catch` de abajo traduce las colisiones concurrentes al mismo error de negocio que el
   * chequeo previo, para que la app siempre reciba el mismo código (`CUSTOMER_ALREADY_EXISTS`) sin
   * importar si perdió la carrera o si simplemente llegó segunda en el tiempo.
   *
   * La deduplicación por `X-Idempotency-Key` (reintentos del MISMO request) la cubre el
   * `IdempotencyInterceptor` global (`src/modules/runtime-hardening/idempotency.interceptor.ts`)
   * sobre la tabla `idempotency_keys`; este bloque cubre el caso distinto de dos requests
   * *diferentes* (claves de idempotencia distintas) que describen al mismo cliente.
   */
  /** AT-025: fachada sobre `StartOnboardingUseCase`; `register` es el adaptador del puerto atómico. Mismos errores públicos. */
  async startOnboarding(
    tenantId: string,
    input: StartOnboardingDto,
    ipAddress: string | null,
    idempotencyKey: string,
  ): Promise<StartOnboardingResponseDto> {
    const useCase = buildStartOnboardingUseCase(this.guardsService, (command) => this.register(command));
    try {
      const result = await useCase.execute({
        tenantId,
        idempotencyKey,
        password: input.password,
        phone: input.customer.phone ?? null,
        email: input.customer.email ?? null,
        consents: input.consents,
        sourceType: input.onboarding?.sourceType ?? 'mobile_app',
        ipAddress,
        registration: input,
      });
      return result.response;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
      }
      if (isApplicationError(error)) throw toHttpException(error);
      throw error;
    }
  }

  /** Adaptador del puerto atómico: TODO el alta en la transacción del puente heredado (AT-015). */
  private async register(command: RegistrationCommand): Promise<RegistrationResult> {
    const { tenantId, registration: input, ipAddress, idempotencyKey, sourceType, phoneHash, emailHash, passwordHash, now } = command;
    // AT-015: el grupo atómico del alta lo abre el puente heredado, que declara su alcance y dueño.
    return this.bridge.run(async (transaction) => {
      const { customer, credential } = await this.customerRecord.createCustomerAndCredentials({
        tenantId,
        input,
        phoneHash,
        emailHash,
        passwordHash,
        now,
        transaction,
      });

      await this.customerRecord.createProfile({ tenantId, customer, input, sourceType, now, transaction });
      await this.customerRecord.createContactMethods({ tenantId, customer, input, phoneHash, emailHash, sourceType, now, transaction });
      await this.customerRecord.createInitialStatusEvent({ tenantId, customer, now, transaction });

      // Dispositivo, sesión e instantánea van siempre juntos: no existe un alta que resuelva el
      // dispositivo y no abra su sesión.
      const { device, session } = await this.deviceSession.openSessionForNewCustomer({
        tenantId,
        customer,
        input,
        ipAddress,
        now,
        transaction,
      });

      const onboardingFlow = await this.registrationTrail.createOnboardingFlowAndFirstEvent({
        tenantId,
        customer,
        session,
        input,
        sourceType,
        phoneHash,
        emailHash,
        now,
        transaction,
      });

      // Permisos, bitácora/auditoría y consentimientos: el rastro de lo que el cliente aceptó y
      // de lo que el sistema hizo con ello, escrito en la misma transacción que lo produjo.
      await this.registrationTrail.recordDecisionsAndAudit({
        tenantId,
        customer,
        session,
        device,
        onboardingFlow,
        input,
        ipAddress,
        idempotencyKey,
        sourceType,
        now,
        transaction,
      });

      // Los tokens se emiten DENTRO de la transacción: si el alta se deshace, el refresh token
      // emitido se deshace con ella. Emitirlos después del commit dejaría una ventana en la que
      // existe una credencial válida para un cliente que la base todavía no confirmó.
      const tokens = await this.tokenIssuer.issueRegistrationTokens({
        tenantId,
        customerId: String(customer.id),
        tokenVersion: credential.tokenVersion,
        ipAddress,
        userAgent: input.device.userAgent ?? null,
        transaction,
      });

      const response = toStartOnboardingResponse({ customer, session, device, onboardingFlow, tokens });
      return {
        customerId: String(customer.id),
        onboardingFlowId: String(onboardingFlow.id),
        sessionId: session ? String(session.id) : null,
        response,
      };
    });
  }
}
