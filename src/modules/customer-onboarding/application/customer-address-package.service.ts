/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { AddressPackageDto } from '../customer-onboarding.schemas.js';

@Injectable()
export class CustomerAddressPackageService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityService: CustomerEligibilityService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async submitAddressPackage(input: {
    tenantId: string;
    customerId: string;
    body: AddressPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    // Era el ÚNICO de los cinco endpoints de guardado sin esta puerta: un cliente en `under_review`,
    // `active`, `rejected` o `closed` podía reescribir su dirección. La transición ilegal la
    // descartaba `advance()` sin ruido, pero el dato quedaba persistido igual — el expediente
    // cambiaba después de haberse enviado a revisión, sin que el estado lo reflejara.
    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    const now = new Date();
    return this.sequelize.transaction(async (transaction) => {
      let address = await this.onboardingRepository.findCurrentAddress(input.tenantId, input.customerId, 'home', { transaction });
      if (!address) {
        address = await this.onboardingRepository.createAddress(
          { tenantId: input.tenantId, customerId: input.customerId, addressType: 'home', now },
          { transaction },
        );
      } else {
        await this.onboardingRepository.touchAddress(address, now, { transaction });
      }

      /*
        La direccion se guarda CIFRADA y su huella se calcula sobre el texto EN CLARO.

        El orden importa. La huella existe para detectar si alguien cambio de domicilio entre dos
        versiones del expediente, y el cifrado de sobre usa una clave e IV nuevos cada vez: dos
        cifrados de la misma calle no se parecen en nada, asi que hashear el criptograma daria
        «cambio de direccion» en cada guardado aunque nadie se haya mudado.

        `addressLineEncrypted` se sigue aceptando por compatibilidad y se guarda tal cual, porque
        ya venia opaco de origen: cifrar lo cifrado no aporta y su huella no seria comparable.
      */
      const direccionEnClaro = input.body.address.addressLine ?? null;
      const declaredAddressText = direccionEnClaro
        ? await encryptSecretEnvelope(direccionEnClaro)
        : (input.body.address.addressLineEncrypted ?? null);
      const normalizedAddressText = direccionEnClaro
        ? sha256Hex(direccionEnClaro)
        : declaredAddressText
          ? sha256Hex(declaredAddressText)
          : null;
      const version = await this.onboardingRepository.createAddressVersion(
        {
          tenantId: input.tenantId,
          customerAddressId: String(address.id),
          declaredAddressText,
          normalizedAddressText,
          zone: input.body.address.zone ?? null,
          city: input.body.address.city,
          department: input.body.address.department,
          countryCode: input.body.address.countryCode,
          sourceType: 'customer_onboarding',
          validFrom: now,
        },
        { transaction },
      );
      await this.onboardingRepository.updateAddressCurrentVersion(address, String(version.id), now, { transaction });

      if (input.body.gpsObservation) {
        const gps = input.body.gpsObservation;
        await this.onboardingRepository.createGpsObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            customerAddressId: String(address.id),
            addressVersionId: String(version.id),
            sessionId: input.body.sessionId ?? null,
            gpsLat: gps.lat.toFixed(7),
            gpsLng: gps.lng.toFixed(7),
            gpsAccuracyMeters: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            capturedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
        await this.onboardingRepository.createCustomerObservation(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            sessionId: input.body.sessionId ?? null,
            deviceId: null,
            observationCode: 'gps_address_observed',
            valueText: null,
            valueNumber: gps.accuracyMeters ? gps.accuracyMeters.toFixed(2) : null,
            valueBoolean: null,
            valueJson: { hasGps: true, accuracyMeters: gps.accuracyMeters ?? null },
            confidenceScore: null,
            observedAt: gps.capturedAt ? new Date(gps.capturedAt) : now,
          },
          { transaction },
        );
      }

      // Registrar la dirección tampoco cambiaba el estado del cliente: el paso quedaba invisible
      // para cualquier regla que mirara `lifecycle_status`.
      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'address_package_submitted',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Dirección declarada por el cliente.',
        transaction,
      });

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'address_package_submitted',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
        },
        { transaction },
      );
      await this.onboardingRepository.createCustomerActionLog(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: null,
          eventName: 'address_package_submitted',
          screenName: 'address_capture',
          payloadJson: { idempotencyKeyHash: sha256Hex(input.idempotencyKey), hasGps: input.body.gpsObservation !== undefined },
          occurredAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.address_package',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { addressId: String(address.id), addressVersionId: String(version.id) },
          occurredAt: now,
        },
        { transaction },
      );

      // `nextStep` lo calcula el evaluador, no un literal de este servicio: el valor fijo
      // `identity_documents` mandaba al cliente a una pantalla que quizá ya había completado.
      const assessment = await this.eligibilityService.evaluate(input.tenantId, input.customerId, transaction);

      return {
        customerId: input.customerId,
        addressId: String(address.id),
        addressVersionId: String(version.id),
        status: 'recorded',
        nextStep: assessment.nextStep,
      };
    });
  }
}
