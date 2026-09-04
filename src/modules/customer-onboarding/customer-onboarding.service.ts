/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { StartOnboardingResponseDto } from './customer-onboarding.dtos.js';
import { CustomerAddressPackageService } from './application/customer-address-package.service.js';
import { CustomerContactVerificationService } from './application/customer-contact-verification.service.js';
import { CustomerIdentityPackageService } from './application/customer-identity-package.service.js';
import { CustomerOnboardingStartService } from './application/customer-onboarding-start.service.js';
import { ExpedienteHooksService } from '../expedientes/application/expediente-hooks.service.js';
import {
  AddressPackageDto,
  ContactVerificationRequestDto,
  ContactVerificationSubmitDto,
  IdentityPackageDto,
  StartOnboardingDto,
} from './customer-onboarding.schemas.js';

@Injectable()
export class CustomerOnboardingService {
  constructor(
    private readonly startService: CustomerOnboardingStartService,
    private readonly contactVerificationService: CustomerContactVerificationService,
    private readonly identityPackageService: CustomerIdentityPackageService,
    private readonly addressPackageService: CustomerAddressPackageService,
    private readonly expedienteHooks: ExpedienteHooksService,
  ) {}

  /**
   * El alta, y después su carpeta.
   *
   * El expediente se abre AQUÍ y no dentro de `startService` por dos razones. Una es de orden: el
   * alta es una transacción y abrir cuatro carpetas no forma parte de ella —un fallo al crearlas
   * habría deshecho el registro entero de un cliente que ya recibió sus tokens—. La otra es de
   * dependencias: coordinar dos colaboradores es el trabajo de esta fachada, y meter el gancho en
   * el servicio transaccional le añadía una dependencia que no usa para nada más.
   *
   * Si la carpeta no llega a crearse, lo peor que pasa es que llegue tarde: el job de relleno la
   * crea y los archivos van a su sitio igual, porque el gancho de evidencia la busca por sujeto.
   */
  async startOnboarding(
    tenantId: string,
    input: StartOnboardingDto,
    ipAddress: string | null,
    idempotencyKey: string,
  ): Promise<StartOnboardingResponseDto> {
    const respuesta = await this.startService.startOnboarding(tenantId, input, ipAddress, idempotencyKey);
    const { customerId, sessionId, customerCode } = respuesta;
    await this.expedienteHooks.alIniciarOnboarding({ tenantId, customerId, sessionId, customerCode: customerCode ?? null });
    return respuesta;
  }

  requestContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationRequestDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.contactVerificationService.requestContactVerification(input);
  }

  submitContactVerification(input: {
    tenantId: string;
    customerId: string;
    body: ContactVerificationSubmitDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.contactVerificationService.submitContactVerification(input);
  }

  submitIdentityPackage(input: {
    tenantId: string;
    customerId: string;
    body: IdentityPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.identityPackageService.submitIdentityPackage(input);
  }

  submitAddressPackage(input: {
    tenantId: string;
    customerId: string;
    body: AddressPackageDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
    idempotencyKey: string;
  }) {
    return this.addressPackageService.submitAddressPackage(input);
  }
}
