/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConsentsRepository } from '../../consents/consents.repository.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { StartOnboardingDto } from '../customer-onboarding.schemas.js';

/**
 * Validaciones previas a la transacción de registro.
 *
 * Se extraen de `CustomerOnboardingStartService` porque son decisiones de admisión —"¿este registro
 * puede siquiera intentarse?"— y no forman parte de la escritura. Separarlas también las hace
 * comprobables en aislamiento, que es lo que hacía falta: la validación de consentimientos estuvo
 * incompleta durante todo el proyecto sin que ningún test lo notara.
 */
@Injectable()
export class CustomerOnboardingGuardsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly consentsRepository: ConsentsRepository,
  ) {}

  /**
   * Duplicados por contacto.
   *
   * Esta comprobación corre FUERA de la transacción, así que por sí sola no evita una carrera: la
   * garantía real la dan los índices únicos parciales `ux_customers_tenant_email_hash` y
   * `ux_customers_tenant_phone_hash` (este último agregado en la migración `20260728090000`; antes
   * no existía, y dos registros concurrentes con el mismo teléfono creaban dos clientes).
   */
  async assertNoDuplicateCustomer(tenantId: string, phoneHash: string | null, emailHash: string | null): Promise<void> {
    const existing = await this.customersRepository.findByContactHash(tenantId, {
      phoneHash: phoneHash ?? undefined,
      emailHash: emailHash ?? undefined,
    });
    if (existing) throw new ConflictException('CUSTOMER_ALREADY_EXISTS');
  }

  /**
   * Consentimientos.
   *
   * Dos reglas distintas que antes estaban colapsadas en una:
   *
   *  1. **Obligatorios**: todos los documentos con `requires_explicit_action` vigentes del tenant
   *     tienen que venir OTORGADOS. Antes solo se comprobaban los consentimientos enviados —que
   *     vinieran `granted: true` y que su documento existiera—, así que con mandar uno solo se
   *     pasaba el control y el cliente quedaba registrado sin aceptar los términos imprescindibles.
   *
   *  2. **Opcionales**: se pueden declinar. La versión anterior rechazaba el registro completo ante
   *     cualquier `granted: false`, incluido el de un documento no obligatorio (marketing): decir
   *     que no a una comunicación comercial impedía abrir la cuenta, y la rama `'declined'` de
   *     `recordConsents` era código inalcanzable. Un consentimiento que no se puede negar no es un
   *     consentimiento.
   */
  async assertConsentDocumentsAreValid(tenantId: string, consents: StartOnboardingDto['consents']): Promise<void> {
    const required = await this.consentsRepository.findRequiredActiveDocuments(tenantId);
    const requiredIds = new Set(required.map((doc) => String(doc.id)));

    for (const consentInput of consents) {
      const doc = await this.consentsRepository.findActiveDocumentById(tenantId, consentInput.consentDocumentId);
      if (!doc) {
        throw new UnprocessableEntityException(
          `Consent document ${consentInput.consentDocumentId} not found, not published, or not active.`,
        );
      }
      if (!consentInput.granted && requiredIds.has(consentInput.consentDocumentId)) {
        throw new UnprocessableEntityException(`REQUIRED_CONSENT_MISSING: ${consentInput.consentDocumentId}`);
      }
    }

    // Solo cuentan como cubiertos los OTORGADOS: enviar un obligatorio con `granted: false` no puede
    // satisfacerlo por el solo hecho de haberlo mencionado.
    const grantedIds = new Set(consents.filter((consent) => consent.granted).map((consent) => consent.consentDocumentId));
    const missing = [...requiredIds].filter((id) => !grantedIds.has(id));
    if (missing.length > 0) {
      throw new UnprocessableEntityException(`REQUIRED_CONSENT_MISSING: ${missing.join(', ')}`);
    }
  }
}
