/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza garantiza que el comercio que el ERP da de alta tenga su carpeta de archivos y su expediente completos desde el primer día.
 * @system busca o abre la ficha del comercio por la cuenta del ERP, la enlaza, asegura su expediente y carga lo que el ERP capturó en el alta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { ExpedientesRepository } from '../../expedientes/repositories/expedientes.repository.js';
import type { PartnerProfileModel } from '../../../database/models/index.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { assertCommercialNetworkEditable, assertPaymentQrEditable, isProfileEditable } from './partner-profile.guards.js';
import { startPartnerOnboardingSchema } from '../partner-onboarding.schemas.js';
import { normalizeBusinessCategory } from '../partner-business-categories.js';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { PartnerCommerceService } from './partner-commerce.service.js';
import { PartnerProfileService } from './partner-profile.service.js';
import { PartnerQrService } from './partner-qr.service.js';
import { PartnerRepresentativeService } from './partner-representative.service.js';
import { PartnerVerificationService } from './partner-verification.service.js';
import type { ErpMerchantExpedienteDto } from '../erp-documents.schemas.js';

export interface ErpMerchantExpedienteResult {
  partnerId: string | null;
  expedienteId: string | null;
  /** `true` si la ficha del comercio se abrió en esta llamada. */
  created: boolean;
  /** Por qué no hay carpeta, cuando no la hay. */
  reason: 'SIN_CORREO_DE_CONTACTO' | 'DATOS_DE_LA_CUENTA_INVALIDOS' | 'CUENTA_ENLAZADA_A_OTRA_FICHA' | null;
  /** Qué partes del expediente cargó ESTA llamada (lo que ya estaba no se repite). */
  loaded: ErpExpedienteParte[];
  /** Lo que sigue faltando para enviar a revisión, tras cargar. Vacío = listo. */
  gaps: string[];
  /** Estado del expediente al terminar (p. ej. `under_review` si se envió). */
  onboardingStatus: string | null;
}

export type ErpExpedienteParte = 'commercial_registry' | 'business_category' | 'legal_representative' | 'branch' | 'bank_qr' | 'submitted';

/**
 * La carpeta y el expediente del comercio cuando el alta la origina el ERP.
 *
 * Hasta el 2026-09-26 la carpeta sólo nacía cuando el comercio abría su ficha desde su portal, así
 * que un onboarding creado en el ERP no tenía dónde anotarse. Y hasta el 2026-10-02 el ERP mandaba
 * seis campos: el expediente nacía con los cuatro requisitos vacíos («Falta 4 requisitos para
 * enviar a revisión») y el comercio tenía que volver a llenar en su portal lo que el vendedor ya
 * había capturado. Pablo: «el usuario te lo pasa una vez y esto debe estar listo y cargado».
 *
 * Idempotente: el ERP la llama al crear el caso y otra vez antes de cada subida de contrato. Cada
 * parte se carga sólo si no estaba (una matrícula ya puesta no se pisa; un representante con el
 * mismo documento no se duplica; una sucursal con el mismo código no se repite; con un QR bancario
 * vigente no se registra otro). Lo que el expediente no admita en su estado actual (p. ej. ya
 * aprobado) se salta sin romper la llamada: el ERP necesita la carpeta igual.
 */
@Injectable()
export class ErpMerchantExpedienteService {
  private readonly logger = new Logger(ErpMerchantExpedienteService.name);

  constructor(
    private readonly profiles: PartnerOnboardingRepository,
    private readonly profileService: PartnerProfileService,
    private readonly expedienteHooks: ExpedienteHooksService,
    private readonly expedientes: ExpedientesRepository,
    private readonly network: PartnerCommercialNetworkRepository,
    private readonly representatives: PartnerRepresentativeService,
    private readonly commerce: PartnerCommerceService,
    private readonly qr: PartnerQrService,
    private readonly verification: PartnerVerificationService,
  ) {}

  async asegurar(tenantId: string, input: ErpMerchantExpedienteDto): Promise<ErpMerchantExpedienteResult> {
    const abierta = await this.abrirOEnlazar(tenantId, input);
    if (!abierta.profile) return abierta.resultado;
    const { created } = abierta;
    let profile = abierta.profile;

    // El dueño es la primera persona concedida por esta cuenta: si el acceso se dio ANTES de que existiera
    // el enlace, `approve` no tenía a quién dárselo. Idempotente; nunca reasigna.
    await this.profiles.adoptOwnerForAccount(tenantId, input.erpAccountId);

    // `start` ya abrió la carpeta de una ficha nueva; para una anterior al 2026-09-17 esto la crea.
    // Abrir es idempotente, así que no importa cuál de los dos casos sea.
    await this.expedienteHooks.alCrearComercio({
      tenantId,
      partnerId: profile.id,
      customerCode: profile.tradeName?.trim() || `NIT ${profile.taxId}`,
    });
    const expediente = await this.expedientes.findExpedientePorSujeto(tenantId, 'partner', profile.id, null);

    const cargado = await this.completar(tenantId, profile, input);
    profile = cargado.profile;
    const { loaded } = cargado;
    const gaps = (await this.verification.findSubmissionGaps(tenantId, profile)).map((gap) => gap.requirement);

    if (input.submitWhenComplete === true && gaps.length === 0 && esEditable(profile)) {
      profile = (await this.profileService.submit(tenantId, profile.id)).profile;
      loaded.push('submitted');
    }
    if (loaded.length > 0) {
      this.logger.log(
        `Expediente de partner cargado desde el ERP: partnerId=${profile.id} partes=${loaded.join(',')} faltan=${gaps.join(',') || 'nada'}`,
      );
    }
    return {
      partnerId: profile.id,
      expedienteId: expediente?.id ?? null,
      created,
      reason: null,
      loaded,
      gaps,
      onboardingStatus: profile.onboardingStatus,
    };
  }

  /** Encuentra la ficha por cuenta o NIT, o la abre; y la enlaza a la cuenta del ERP. */
  private async abrirOEnlazar(
    tenantId: string,
    input: ErpMerchantExpedienteDto,
  ): Promise<{ profile: PartnerProfileModel; created: boolean } | { profile: null; resultado: ErpMerchantExpedienteResult }> {
    let created = false;
    let profile = await this.buscar(tenantId, input);

    if (!profile) {
      if (!input.contactEmail) return { profile: null, resultado: vacio('SIN_CORREO_DE_CONTACTO') };
      const datos = startPartnerOnboardingSchema.safeParse({
        legalName: input.legalName,
        tradeName: input.tradeName || undefined,
        taxId: input.taxId,
        commercialRegistry: input.commercialRegistry || undefined,
        businessCategory: input.businessCategory || undefined,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || undefined,
      });
      if (!datos.success) {
        this.logger.warn(
          `La cuenta ERP ${input.erpAccountId} no tiene datos válidos para abrir la ficha: ${datos.error.issues[0]?.message ?? ''}`,
        );
        return { profile: null, resultado: vacio('DATOS_DE_LA_CUENTA_INVALIDOS') };
      }
      // Sin dueño: la abre el sistema en nombre del ERP, no un comercio.
      profile = await this.profileService.start(tenantId, datos.data, undefined);
      created = true;
    }

    if (profile.erpAccountId && profile.erpAccountId !== input.erpAccountId) {
      // Dos cuentas del ERP reclamando la misma ficha es un problema de datos: se dice, no se pisa.
      return {
        profile: null,
        resultado: { ...vacio('CUENTA_ENLAZADA_A_OTRA_FICHA'), partnerId: profile.id, created, onboardingStatus: profile.onboardingStatus },
      };
    }
    if (!profile.erpAccountId) profile = await this.profiles.updateProfile(profile, { erpAccountId: input.erpAccountId });
    return { profile, created };
  }

  /** Carga lo que el ERP capturó, parte a parte y sólo lo que falta. */
  private async completar(
    tenantId: string,
    profile: PartnerProfileModel,
    input: ErpMerchantExpedienteDto,
  ): Promise<{ profile: PartnerProfileModel; loaded: ErpExpedienteParte[] }> {
    const loaded: ErpExpedienteParte[] = [];
    const cambios: Record<string, string> = {};
    if (input.commercialRegistry && !profile.commercialRegistry && esEditable(profile)) {
      cambios.commercialRegistry = input.commercialRegistry;
      loaded.push('commercial_registry');
    }
    // El rubro del ERP es texto libre de su CRM; sólo entra si cae en el catálogo del expediente.
    const rubro = input.businessCategory ? normalizeBusinessCategory(input.businessCategory) : null;
    if (rubro && !profile.businessCategory) {
      cambios.businessCategory = rubro;
      loaded.push('business_category');
    }
    if (Object.keys(cambios).length > 0) profile = await this.profiles.updateProfile(profile, cambios);

    if (input.legalRepresentative && esEditable(profile)) {
      const existentes = await this.network.listRepresentatives(tenantId, profile.id);
      const mismo = existentes.find((item) => item.documentNumber === input.legalRepresentative?.documentNumber);
      if (!mismo) {
        await this.representatives.addLegalRepresentative(tenantId, profile.id, input.legalRepresentative);
        loaded.push('legal_representative');
      }
    }

    if (await this.cargarSucursal(tenantId, profile, input.branch)) {
      loaded.push('branch');
    }

    if (await this.cargarQrBanco(tenantId, profile, input.bankQr)) {
      loaded.push('bank_qr');
    }
    return { profile, loaded };
  }

  /** Registra la sucursal si su código aún no existe; devuelve si la cargó. */
  private async cargarSucursal(
    tenantId: string,
    profile: PartnerProfileModel,
    branch: ErpMerchantExpedienteDto['branch'],
  ): Promise<boolean> {
    if (!branch || !admite(assertCommercialNetworkEditable, profile)) return false;
    const sucursales = await this.network.listBranches(tenantId, profile.id);
    if (sucursales.some((item) => item.branchCode === branch.branchCode)) return false;
    await this.commerce.registerBranch(tenantId, profile.id, branch);
    return true;
  }

  /** Registra el QR bancario si no hay uno vigente; devuelve si lo cargó. */
  private async cargarQrBanco(
    tenantId: string,
    profile: PartnerProfileModel,
    bankQr: ErpMerchantExpedienteDto['bankQr'],
  ): Promise<boolean> {
    if (!bankQr || !admite(assertPaymentQrEditable, profile)) return false;
    const vigente = await this.network.findLiveQr(tenantId, profile.id, 'bank', null);
    if (vigente) return false;
    await this.qr.register(tenantId, profile.id, { ...bankQr, qrKind: 'bank' });
    return true;
  }

  private async buscar(tenantId: string, input: ErpMerchantExpedienteDto): Promise<PartnerProfileModel | null> {
    const { rows } = await this.profiles.findProfilesByExternalKeys(
      tenantId,
      { erpAccountId: input.erpAccountId },
      { limit: 1, offset: 0 },
    );
    if (rows[0]) return rows[0];
    return input.taxId ? this.profiles.findProfileByTaxId(tenantId, input.taxId) : null;
  }
}

function esEditable(profile: PartnerProfileModel): boolean {
  return isProfileEditable(profile);
}

function vacio(reason: ErpMerchantExpedienteResult['reason']): ErpMerchantExpedienteResult {
  return { partnerId: null, expedienteId: null, created: false, reason, loaded: [], gaps: [], onboardingStatus: null };
}

/** Pasa una compuerta del expediente en modo «saltar»: false en vez de lanzar, para no romper la carga. */
function admite(compuerta: (profile: PartnerProfileModel) => void, profile: PartnerProfileModel): boolean {
  try {
    compuerta(profile);
    return true;
  } catch {
    return false;
  }
}
