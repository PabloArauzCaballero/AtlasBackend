/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { RequestWithNetwork, requireIdempotencyKey } from '../../common/utils/http/headers.util.js';
import { CustomerContactMethodsService } from './application/customer-contact-methods.service.js';
import { CustomerDocumentUploadService } from './application/customer-document-upload.service.js';
import { CustomerIdentityProviderVerificationService } from './application/customer-identity-provider-verification.service.js';
import { CustomerFinancialProfileService } from './application/customer-financial-profile.service.js';
import { CustomerProfileUpdateService } from './application/customer-profile-update.service.js';
import { CustomerReferenceContactsService } from './application/customer-reference-contacts.service.js';
import {
  AddContactMethodDto,
  FinancialProfileDto,
  ReferenceContactIdParamsDto,
  ReferenceContactsDto,
  UpdateProfileDto,
  UploadUrlRequestDto,
  VerifyIdentityDto,
  addContactMethodSchema,
  financialProfileSchema,
  referenceContactIdParamsSchema,
  referenceContactsSchema,
  updateProfileSchema,
  uploadUrlRequestSchema,
  verifyIdentitySchema,
} from './customer-onboarding-profile.schemas.js';
import { OnboardingCustomerIdParamsDto, onboardingCustomerIdParamsSchema } from './customer-onboarding.schemas.js';

const CUSTOMER_AND_INTERNAL = ['customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin'] as const;

/**
 * Registro progresivo del cliente: perfil personal, económico, referencias, contactos, avance y
 * envío a revisión.
 *
 * Se separa del controlador de paquetes (`customer-onboarding.controller.ts`) por dos razones: ese
 * archivo ya cubre otro caso de uso —los paquetes atómicos de identidad y dirección— y el gate de
 * tamaño de archivo del repositorio (300 líneas para código runtime nuevo) obliga a no acumular.
 *
 * Todos los endpoints de escritura de este controlador aceptan guardado PARCIAL: validan el formato
 * de lo que llega, nunca la completitud. La completitud se verifica una sola vez, al enviar.
 */
@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
@Controller('customer-onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CustomerOnboardingProfileController {
  constructor(
    private readonly profileUpdateService: CustomerProfileUpdateService,
    private readonly financialProfileService: CustomerFinancialProfileService,
    private readonly referenceContactsService: CustomerReferenceContactsService,
    private readonly contactMethodsService: CustomerContactMethodsService,
    private readonly documentUploadService: CustomerDocumentUploadService,
    private readonly identityProviderVerificationService: CustomerIdentityProviderVerificationService,
  ) {}

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Actualizar datos personales (guardado parcial)',
    description:
      'Persiste los campos enviados creando una versión nueva del perfil y cerrando la anterior. Acepta actualizaciones ' +
      'parciales: es la base del autoguardado por sección. Valida edad mínima y máxima cuando se envía `birthDate`.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(updateProfileSchema) })
  @ApiResponse({ status: 200, description: 'Perfil actualizado — devuelve la versión vigente.' })
  @ApiResponse({ status: 422, description: 'PROFILE_NOT_EDITABLE_IN_STATUS — el estado del cliente no admite edición.' })
  @Patch(':customerId/profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.profileUpdateService.updateProfile({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Registrar información laboral y económica (guardado parcial)',
    description:
      'Persiste los atributos económicos declarados sobre `customer_attribute_values`, cerrando la vigencia del valor ' +
      'anterior de cada atributo. Acepta actualizaciones parciales.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(financialProfileSchema) })
  @ApiResponse({ status: 200, description: 'Atributos económicos actualizados.' })
  @ApiResponse({ status: 422, description: 'PROFILE_NOT_EDITABLE_IN_STATUS o ATTRIBUTE_CATALOG_NOT_SEEDED.' })
  @Put(':customerId/financial-profile')
  @HttpCode(HttpStatus.OK)
  upsertFinancialProfile(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(financialProfileSchema)) body: FinancialProfileDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.financialProfileService.upsertFinancialProfile({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({ summary: 'Listar referencias personales', description: 'Devuelve las referencias sin exponer nombre ni teléfono.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiResponse({ status: 200, description: 'Referencias registradas (solo últimos 4 dígitos del teléfono).' })
  @Get(':customerId/reference-contacts')
  listReferences(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.referenceContactsService.listReferences({
      tenantId: tenantId,
      customerId: params.customerId,
      currentUser,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Registrar referencias personales',
    description:
      'Alta de una o varias referencias. Nombre y teléfono se guardan hasheados y cifrados: son datos de un tercero. ' +
      '`consentBasis` es obligatorio y declara la base legal del tratamiento.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(referenceContactsSchema) })
  @ApiResponse({ status: 201, description: 'Referencias registradas.' })
  @ApiResponse({ status: 409, description: 'REFERENCE_ALREADY_REGISTERED — ese teléfono ya figura como referencia.' })
  @ApiResponse({ status: 422, description: 'REFERENCE_LIMIT_EXCEEDED o REFERENCE_CANNOT_BE_THE_CUSTOMER.' })
  @Post(':customerId/reference-contacts')
  @HttpCode(HttpStatus.CREATED)
  addReferences(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(referenceContactsSchema)) body: ReferenceContactsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.referenceContactsService.addReferences({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({ summary: 'Quitar una referencia personal', description: 'Borrado lógico: la declaración original se conserva.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Referencia retirada.' })
  @ApiResponse({ status: 404, description: 'REFERENCE_NOT_FOUND.' })
  @Delete(':customerId/reference-contacts/:referenceId')
  @HttpCode(HttpStatus.OK)
  removeReference(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(referenceContactIdParamsSchema)) params: ReferenceContactIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.referenceContactsService.removeReference({
      tenantId: tenantId,
      customerId: params.customerId,
      referenceId: params.referenceId,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Agregar o corregir un método de contacto',
    description:
      'Registra un teléfono o correo adicional en estado `unverified`. Resuelve el caso de un contacto mal escrito en el ' +
      'registro, que antes dejaba la cuenta sin forma de recibir el código de verificación.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(addContactMethodSchema) })
  @ApiResponse({ status: 201, description: 'Contacto registrado — queda pendiente de verificación.' })
  @ApiResponse({ status: 409, description: 'CONTACT_ALREADY_REGISTERED.' })
  @Post(':customerId/contact-methods')
  @HttpCode(HttpStatus.CREATED)
  addContactMethod(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(addContactMethodSchema)) body: AddContactMethodDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.contactMethodsService.addContactMethod({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Solicitar una URL de subida de documento',
    description:
      'Devuelve una URL prefirmada de un solo uso para subir un documento directamente al almacenamiento. El servidor IMPONE ' +
      'la ruta del objeto (`tenant/cliente/tipo/uuid`) y firma `Content-Type` y `Content-Length`: subir algo distinto a lo ' +
      'autorizado es rechazado por el almacenamiento. El `storageKey` devuelto es el que debe enviarse luego en el paquete ' +
      'de identidad.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(uploadUrlRequestSchema) })
  @ApiResponse({ status: 201, description: 'Permiso de subida — `{ storageKey, uploadUrl, method, requiredHeaders, expiresAt }`.' })
  @ApiResponse({ status: 422, description: 'PROFILE_NOT_EDITABLE_IN_STATUS o EVIDENCE_OBJECT_TOO_LARGE.' })
  @ApiResponse({ status: 503, description: 'DOCUMENT_STORAGE_NOT_CONFIGURED — no hay almacenamiento configurado.' })
  @Post(':customerId/documents/upload-url')
  @HttpCode(HttpStatus.CREATED)
  createUploadUrl(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(uploadUrlRequestSchema)) body: UploadUrlRequestDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.documentUploadService.createUploadUrl({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
    });
  }

  @Roles(...CUSTOMER_AND_INTERNAL)
  @ApiOperation({
    summary: 'Verificar la identidad contra el registro externo',
    description:
      'Consulta el registro estatal de identidad con los datos ya declarados y resuelve el expediente según lo que responda: ' +
      '`FOUND` sin observaciones ⇒ `verified` (y aprueba la evidencia documental); `NOT_FOUND` ⇒ `rejected` y el cliente vuelve ' +
      'a `observed`; `PARTIAL_MATCH` o una caída del proveedor ⇒ queda `pending_review` para un analista. El número de documento ' +
      'se usa para consultar y NO se persiste; debe coincidir por hash con el ya declarado en el paquete de identidad.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'x-idempotency-key', required: true })
  @ApiParam({ name: 'customerId', schema: zodToApiSchema(onboardingCustomerIdParamsSchema.shape.customerId) })
  @ApiBody({ schema: zodToApiSchema(verifyIdentitySchema) })
  @ApiResponse({ status: 200, description: 'Resultado del proveedor, veredicto aplicado y elegibilidad resultante.' })
  @ApiResponse({
    status: 422,
    description: 'IDENTITY_PACKAGE_REQUIRED, IDENTITY_ALREADY_VERIFIED, DOCUMENT_NUMBER_MISMATCH o PROFILE_INCOMPLETE_FOR_VERIFICATION.',
  })
  @Post(':customerId/identity-verification')
  @HttpCode(HttpStatus.OK)
  verifyIdentity(
    @CurrentTenant() tenantId: string,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Body(new ZodValidationPipe(verifyIdentitySchema)) body: VerifyIdentityDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() request: RequestWithNetwork,
  ) {
    return this.identityProviderVerificationService.verifyWithProvider({
      tenantId: tenantId,
      customerId: params.customerId,
      body,
      currentUser,
      ipAddress: request.ip ?? null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}
