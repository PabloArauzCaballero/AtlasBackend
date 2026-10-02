/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza garantiza que el comercio que el ERP da de alta tenga su carpeta de archivos desde el primer día.
 * @system busca o abre la ficha del comercio por la cuenta del ERP, la enlaza y asegura su expediente con qr/documentos/otros.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { ExpedientesRepository } from '../../expedientes/repositories/expedientes.repository.js';
import type { PartnerProfileModel } from '../../../database/models/index.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { startPartnerOnboardingSchema } from '../partner-onboarding.schemas.js';
import { PartnerProfileService } from './partner-profile.service.js';
import type { ErpMerchantExpedienteDto } from '../erp-documents.schemas.js';

export interface ErpMerchantExpedienteResult {
  partnerId: string | null;
  expedienteId: string | null;
  /** `true` si la ficha del comercio se abrió en esta llamada. */
  created: boolean;
  /** Por qué no hay carpeta, cuando no la hay. */
  reason: 'SIN_CORREO_DE_CONTACTO' | 'DATOS_DE_LA_CUENTA_INVALIDOS' | 'CUENTA_ENLAZADA_A_OTRA_FICHA' | null;
}

/**
 * La carpeta del comercio (Operaciones › Archivos) cuando el alta la origina el ERP.
 *
 * Hasta el 2026-09-26 la carpeta sólo nacía cuando el comercio abría su ficha desde su portal, así
 * que un onboarding creado en el ERP —y todo lo que el ERP guardaba después, como el contrato
 * firmado— no tenía dónde anotarse: el objeto quedaba en el almacén y nadie lo veía en Archivos.
 * Pablo pidió que la carpeta exista desde que se crea el onboarding, y que el ERP abra la ficha si
 * falta.
 *
 * Idempotente: el ERP la llama al crear el caso y otra vez antes de cada subida de contrato. Busca
 * primero por la cuenta, luego por NIT; sólo abre una ficha nueva si no hay ninguna. La ficha que
 * abre el ERP queda SIN dueño en el portal del comercio (igual que una abierta por personal
 * interno en `start`): el dueño lo pone el alta de su usuario (`approve`) o, si ésta ya ocurrió, esta llamada.
 */
@Injectable()
export class ErpMerchantExpedienteService {
  private readonly logger = new Logger(ErpMerchantExpedienteService.name);

  constructor(
    private readonly profiles: PartnerOnboardingRepository,
    private readonly profileService: PartnerProfileService,
    private readonly expedienteHooks: ExpedienteHooksService,
    private readonly expedientes: ExpedientesRepository,
  ) {}

  async asegurar(tenantId: string, input: ErpMerchantExpedienteDto): Promise<ErpMerchantExpedienteResult> {
    let created = false;
    let profile = await this.buscar(tenantId, input);

    if (!profile) {
      if (!input.contactEmail) return vacio('SIN_CORREO_DE_CONTACTO');
      const datos = startPartnerOnboardingSchema.safeParse({
        legalName: input.legalName,
        tradeName: input.tradeName || undefined,
        taxId: input.taxId,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || undefined,
      });
      if (!datos.success) {
        this.logger.warn(
          `La cuenta ERP ${input.erpAccountId} no tiene datos válidos para abrir la ficha: ${datos.error.issues[0]?.message ?? ''}`,
        );
        return vacio('DATOS_DE_LA_CUENTA_INVALIDOS');
      }
      // Sin dueño: la abre el sistema en nombre del ERP, no un comercio.
      profile = await this.profileService.start(tenantId, datos.data, undefined);
      created = true;
    }

    if (profile.erpAccountId && profile.erpAccountId !== input.erpAccountId) {
      // Dos cuentas del ERP reclamando la misma ficha es un problema de datos: se dice, no se pisa.
      return { partnerId: profile.id, expedienteId: null, created, reason: 'CUENTA_ENLAZADA_A_OTRA_FICHA' };
    }
    if (!profile.erpAccountId) profile = await this.profiles.updateProfile(profile, { erpAccountId: input.erpAccountId });
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
    return { partnerId: profile.id, expedienteId: expediente?.id ?? null, created, reason: null };
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

function vacio(reason: ErpMerchantExpedienteResult['reason']): ErpMerchantExpedienteResult {
  return { partnerId: null, expedienteId: null, created: false, reason };
}
