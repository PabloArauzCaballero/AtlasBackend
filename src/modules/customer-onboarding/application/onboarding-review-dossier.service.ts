/**
 * @file Servicio de aplicación: arma el expediente del alta que ve quien revisa la identidad.
 * @business Pablo pidió (2026-09-28) que TODO lo que el teléfono deja guardado llegue al caso abierto del alta en el Motor: cronómetro, bitácora, dispositivo, permisos, ubicación, agenda, SEGIP y lo declarado frente al carnet.
 * @system sólo lectura; reutiliza las respuestas del alta, el resumen de comportamiento y los agregados de la agenda. Un bloque sin dato es `null`, nunca inventado.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { OnboardingBehaviorSummaryService } from '../../customer-telemetry/application/onboarding-behavior-summary.service.js';
import { OnboardingReviewDossierRepository } from '../repositories/onboarding-review-dossier.repository.js';
import { CustomerContactsSnapshotService } from './customer-contacts-snapshot.service.js';
import { CustomerOnboardingAnswersService } from './customer-onboarding-answers.service.js';
import {
  agendaDe,
  carnetVsDeclarado,
  contactoDeclarado,
  cronometroDe,
  dispositivoDe,
  domicilioDeclarado,
  empleoDeclarado,
  extractoDeclarado,
  identidadDeclarada,
  ubicacionDe,
  type AgendaLeida,
} from './onboarding-review-dossier.bloques.js';
import { isoONulo, ultimosConsentimientos, ultimosPermisos } from './onboarding-review-dossier.mapeo.js';
import { ONBOARDING_REVIEW_DOSSIER_VERSION, type OnboardingReviewDossier } from './onboarding-review-dossier.types.js';

@Injectable()
export class OnboardingReviewDossierService {
  private readonly logger = new Logger(OnboardingReviewDossierService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly answers: CustomerOnboardingAnswersService,
    private readonly repository: OnboardingReviewDossierRepository,
    private readonly contacts: CustomerContactsSnapshotService,
    private readonly behavior: OnboardingBehaviorSummaryService,
  ) {}

  async build(tenantId: string, customerId: string): Promise<OnboardingReviewDossier> {
    const customer = await this.customers.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    const now = new Date();

    const [answers, document, contactMethods, attempts, statement, evidence] = await Promise.all([
      this.answers.read(tenantId, customerId),
      this.repository.findCurrentIdentityDocument(tenantId, customerId),
      this.repository.findContactMethods(tenantId, customerId),
      this.repository.findRecentAttempts(tenantId, customerId),
      this.seguro('extracto', this.repository.findLatestBankStatement(tenantId, customerId), null),
      this.seguro('evidencias', this.repository.findEvidence(tenantId, customerId), []),
    ]);
    const [cronometro, dispositivo, senales, pings, agenda] = await Promise.all([
      this.seguro('cronometro', this.cronometro(tenantId, customerId), null),
      this.seguro('dispositivo', this.repository.findDevice(tenantId, customerId).then(dispositivoDe), null),
      this.seguro('permisos', this.permisosYConsentimientos(tenantId, customerId), { permisos: [], consentimientos: [] }),
      this.seguro('ubicacion', this.repository.findPings(tenantId, customerId), []),
      this.seguro('agenda', this.agenda(tenantId, customerId), null),
    ]);

    return {
      version: ONBOARDING_REVIEW_DOSSIER_VERSION,
      generadoEn: now.toISOString(),
      cliente: { customerId, customerCode: customer.customerCode, estado: customer.lifecycleStatus },
      declarado: {
        ...identidadDeclarada(answers.personalData, document?.declaredNumberLast4 ?? null, now),
        ...contactoDeclarado(contactMethods, customer),
        domicilio: domicilioDeclarado(answers.address),
        empleo: empleoDeclarado(answers.financialProfile),
        extracto: extractoDeclarado(statement),
      },
      carnetVsDeclarado: carnetVsDeclarado(attempts, document, answers.personalData),
      cronometro,
      dispositivo,
      permisos: senales.permisos,
      consentimientos: senales.consentimientos,
      ubicacion: ubicacionDe(answers.address, pings, senales.permisos),
      agenda: agendaDe(agenda, senales.consentimientos),
      evidencias: evidence.map((row) => ({ tipo: row.documentType ?? 'other', fecha: isoONulo(row.uploadedAt) })),
    };
  }

  /** El resumen VIGENTE, sin recalcular: construir el expediente no escribe filas de comportamiento. */
  private async cronometro(tenantId: string, customerId: string): Promise<OnboardingReviewDossier['cronometro']> {
    const [resumen, flow] = await Promise.all([
      this.behavior.ultimo(tenantId, customerId),
      this.repository.findLatestFlow(tenantId, customerId),
    ]);
    return cronometroDe(resumen, flow);
  }

  private async permisosYConsentimientos(tenantId: string, customerId: string) {
    const [eventos, consentimientos] = await Promise.all([
      this.repository.findPermissionEvents(tenantId, customerId),
      this.repository.findConsents(tenantId, customerId),
    ]);
    return { permisos: ultimosPermisos(eventos), consentimientos: ultimosConsentimientos(consentimientos) };
  }

  private async agenda(tenantId: string, customerId: string): Promise<AgendaLeida> {
    const [features, alcance, sincronizados] = await Promise.all([
      this.contacts.featuresFor(tenantId, customerId),
      this.repository.findAddressBookScope(tenantId, customerId),
      this.repository.countSyncedContacts(tenantId, customerId),
    ]);
    return { ...features, alcance, sincronizados };
  }

  /** Un bloque que no se puede leer queda vacío y en el log; no tumba el expediente entero. */
  private async seguro<T>(bloque: string, promesa: Promise<T>, vacio: T): Promise<T> {
    try {
      return await promesa;
    } catch (error: unknown) {
      this.logger.warn(
        `Expediente del alta: el bloque ${bloque} no se pudo leer: ${error instanceof Error ? error.message : String(error)}`,
      );
      return vacio;
    }
  }
}
