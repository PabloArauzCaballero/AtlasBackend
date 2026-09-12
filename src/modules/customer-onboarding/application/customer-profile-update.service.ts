/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { calculateAgeInYears } from '../../customers/application/customer-eligibility.evaluator.js';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { IDENTITY_VERIFIED_RESULT } from '../../customers/customer-eligibility.constants.js';
import { UpdateProfileDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerProfileDataRepository } from '../repositories/customer-profile-data.repository.js';
import { ConsentsRepository } from '../../consents/consents.repository.js';

/** El documento cuyo texto acredita el permiso. Lo siembra `20260823020000-add-marketing-consent-document`. */
const MARKETING_CONSENT_CODE = 'marketing_communications';

function normalizeFullName(firstName: string | null, lastName: string | null): string | null {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName.length === 0 ? null : fullName.toLocaleLowerCase('es-BO');
}

/**
 * Registro progresivo de los datos personales (N2).
 *
 * Antes, nombre, apellido y fecha de nacimiento solo podían enviarse —opcionalmente— en el momento
 * del registro, y después NO existía forma de completarlos ni de corregirlos. Este endpoint sostiene
 * el guardado parcial: persiste lo que llega, campo a campo, sin exigir completitud. La verificación
 * de obligatoriedad vive en el envío del paquete y en la regla de habilitación.
 *
 * Cada cambio crea una VERSIÓN nueva del perfil y cierra la anterior (`valid_until`,
 * `supersedes_version_id`). El versionado ya estaba en el esquema y se usaba una sola vez; aquí pasa
 * a cumplir su función: un dato corregido nunca borra al anterior.
 */
@Injectable()
export class CustomerProfileUpdateService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly profileDataRepository: CustomerProfileDataRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
    private readonly consentsRepository: ConsentsRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async updateProfile(input: {
    tenantId: string;
    customerId: string;
    body: UpdateProfileDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);

    /*
     * Un cliente ACTIVO también puede corregir sus datos.
     *
     * Antes la edición sólo existía durante el onboarding: al quedar `active` el endpoint respondía
     * `PROFILE_NOT_EDITABLE_IN_STATUS` y no había ningún otro camino. El resultado práctico es que
     * un dato mal escrito —un apellido, el idioma— se quedaba mal para siempre, y la única salida
     * era soporte. Terminar el alta no es dejar de ser una persona con datos que cambian.
     *
     * Lo que sigue bloqueado son los estados que bloquean TODO (`blocked`, `rejected`, `closed`),
     * porque ahí el problema no es el dato.
     */
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status) && status !== 'active') {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }

    await this.assertIdentityFieldsEditable(input.tenantId, input.customerId, input.body);

    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      const current = await this.profileDataRepository.findCurrentProfile(input.tenantId, input.customerId, { transaction });

      const firstName = input.body.firstName ?? current?.firstName ?? null;
      const lastName = input.body.lastName ?? current?.lastName ?? null;
      const birthDate = input.body.birthDate ?? current?.birthDate ?? null;

      if (current) {
        await this.profileDataRepository.closeProfileVersion(current, now, { transaction });
      }

      const profile = await this.profileDataRepository.createProfileVersion(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          firstName,
          lastName,
          fullNameNormalized: normalizeFullName(firstName, lastName),
          birthDate,
          ageAtCapture: birthDate ? calculateAgeInYears(birthDate, now) : null,
          genderDeclared: input.body.genderDeclared ?? current?.genderDeclared ?? null,
          preferredLanguage: input.body.preferredLanguage ?? current?.preferredLanguage ?? 'es',
          marketingOptIn: input.body.marketingOptIn ?? current?.marketingOptIn ?? false,
          sourceType: 'customer_self_service',
          supersedesVersionId: current ? String(current.id) : null,
          validFrom: now,
        },
        { transaction },
      );

      await this.customersRepository.updateCurrentProfileVersion(customer, String(profile.id), now, { transaction });

      await this.recordMarketingConsent({
        tenantId: input.tenantId,
        customerId: input.customerId,
        marketingOptIn: input.body.marketingOptIn,
        ipAddress: input.ipAddress,
        now,
        transaction,
      });

      const flow = await this.onboardingRepository.findLatestOnboardingFlow(input.tenantId, input.customerId, { transaction });
      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'personal_data_updated',
          eventType: 'completed',
          happenedAt: now,
          payloadJson: { updatedFields: Object.keys(input.body), profileVersionId: String(profile.id) },
        },
        { transaction },
      );

      // Avance de mejor esfuerzo: completar datos personales no debe fallar porque el cliente ya
      // esté en revisión; el dato sí se guarda y la transición simplemente se descarta.
      await this.lifecycleService.advance({
        tenantId: input.tenantId,
        customerId: input.customerId,
        toStatus: 'onboarding_in_progress',
        reasonCode: 'personal_data_updated',
        changedByType: input.currentUser.role,
        changedByInternalUserId: input.currentUser.internalUserId ?? null,
        notes: 'Datos personales actualizados por el cliente.',
        transaction,
      });

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.profile_updated',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: { updatedFields: Object.keys(input.body), profileVersionId: String(profile.id) },
          occurredAt: now,
        },
        { transaction },
      );

      return {
        customerId: input.customerId,
        profileVersionId: String(profile.id),
        firstName: profile.firstName,
        lastName: profile.lastName,
        birthDate: profile.birthDate,
        genderDeclared: profile.genderDeclared,
        preferredLanguage: profile.preferredLanguage,
        marketingOptIn: profile.marketingOptIn,
        supersedesVersionId: profile.supersedesVersionId,
      };
    });
  }

  /**
   * Nombre, apellido y fecha de nacimiento se congelan cuando el carnet ya se verificó.
   *
   * No es rigidez administrativa: esos tres campos son los que se contrastaron contra el documento
   * de identidad. Dejar que el titular los reescriba después convierte una verificación en una
   * declaración —el expediente diría «verificado» sobre unos datos que nadie miró—, y es exactamente
   * el hueco por el que se cuela una suplantación: verificar con un documento propio y luego cambiar
   * el nombre.
   *
   * Corregir un dato verificado sigue siendo posible, pero no por autoservicio: lo hace operaciones
   * con el documento delante. El mensaje lo dice, para que quien lo lea sepa a dónde ir en vez de
   * quedarse mirando un error.
   *
   * El resto del perfil —idioma, género declarado, si quiere publicidad— no se verificó contra nada
   * y se edita siempre.
   */
  private async assertIdentityFieldsEditable(tenantId: string, customerId: string, body: UpdateProfileDto): Promise<void> {
    const touched = (['firstName', 'lastName', 'birthDate'] as const).filter((field) => body[field] !== undefined);
    if (touched.length === 0) return;

    const facts = await this.eligibilityRepository.loadFacts(tenantId, customerId);
    if (facts.identityVerificationResult !== IDENTITY_VERIFIED_RESULT) return;

    throw new UnprocessableEntityException(
      `IDENTITY_FIELDS_LOCKED: ${touched.join(', ')}. Tu identidad ya fue verificada con tu documento; ` +
        'para corregir estos datos escribe a soporte y los revisa una persona.',
    );
  }

  /**
   * Deja constancia del permiso de marketing en el REGISTRO DE CONSENTIMIENTOS.
   *
   * Antes sólo se guardaba `marketing_opt_in` en la versión del perfil, que dice el estado pero no
   * acredita el permiso: ante un reclamo por publicidad no consentida hay que poder enseñar qué texto
   * se aceptó, cuándo y desde dónde. Eso vive en `privacy.customer_consents`, igual que los otros
   * tres consentimientos del alta.
   *
   * ## Se anota también el NO
   *
   * Desmarcar la casilla escribe una fila con `granted = false`, no borra la anterior. La retirada de
   * un consentimiento es justo lo que más falta hace poder probar, y un registro que sólo guarda los
   * síes no puede demostrar que alguien pidió dejar de recibir.
   *
   * ## Por qué no rompe el guardado
   *
   * Si el documento no está sembrado en este tenant, el perfil se guarda igual y esto no se escribe:
   * que el catálogo legal falte es un problema de despliegue, y convertirlo en un error de «guardar
   * mis datos» dejaría a la persona sin poder corregir su apellido por una casilla opcional.
   */
  private async recordMarketingConsent(input: {
    tenantId: string;
    customerId: string;
    marketingOptIn: boolean | undefined;
    ipAddress: string | null;
    now: Date;
    transaction: Transaction;
  }): Promise<void> {
    // `undefined` es «no me lo mandaron», que no es lo mismo que «lo desmarcó».
    if (input.marketingOptIn === undefined) return;

    const [document] = await this.consentsRepository.findActiveDocuments(input.tenantId, {
      language: 'es',
      purposeCode: MARKETING_CONSENT_CODE,
    });
    if (!document) return;

    const consent = await this.consentsRepository.createCustomerConsent(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        consentDocumentId: String(document.id),
        purposeCode: MARKETING_CONSENT_CODE,
        granted: input.marketingOptIn,
        channel: 'mobile_app',
        sessionId: null,
        ipAddress: input.ipAddress,
        deviceFingerprintSnapshot: null,
        userAgent: null,
        evidenceSnapshotUrl: null,
        happenedAt: input.now,
      },
      { transaction: input.transaction },
    );

    await this.consentsRepository.createConsentEvent(
      {
        tenantId: input.tenantId,
        customerConsentId: String(consent.id),
        eventType: input.marketingOptIn ? 'granted' : 'revoked',
        channel: 'mobile_app',
        sessionId: null,
        ipAddress: input.ipAddress,
        deviceFingerprintSnapshot: null,
        triggeredByType: 'customer',
        triggeredByInternalUserId: null,
        notes: 'Preferencia de novedades y promociones actualizada desde la app.',
        happenedAt: input.now,
      },
      { transaction: input.transaction },
    );
  }
}
