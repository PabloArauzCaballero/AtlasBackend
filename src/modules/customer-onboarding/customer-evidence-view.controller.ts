/**
 * @file Controlador HTTP: sirve al analista las imágenes con las que debe decidir.
 * @business Sin ver el carnet y la selfie, una revisión manual de identidad es una firma a ciegas.
 * @system lista los documentos de un cliente y devuelve sus bytes desde el almacenamiento.
 */
import { Controller, Get, Header, NotFoundException, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { onboardingCustomerIdParamsSchema, type OnboardingCustomerIdParamsDto } from './customer-onboarding.schemas.js';
import { CustomerVerificationRepository } from './repositories/customer-verification.repository.js';

/**
 * Las fotos del carnet, para quien tiene que mirarlas.
 *
 * La revisión manual de identidad ocurre en el Decision Engine, que es OTRO sistema con otra base:
 * lo único que recibe de las imágenes es su hash, porque las imágenes nunca salen de aquí. El
 * resultado práctico era que el analista abría el caso, leía «parecido 0.90» y tenía que decidir si
 * la persona del carnet es quien dice ser SIN VER NI EL CARNET NI LA CARA.
 *
 * Eso no es una revisión humana: es refrendar la cifra de una máquina. Este endpoint es lo que le
 * pone las imágenes delante.
 *
 * ## Por qué los bytes y no una URL firmada
 *
 * Porque una URL firmada del almacenamiento es un enlace que funciona sin sesión mientras no venza:
 * cualquiera con el enlace ve el carnet de una persona. Sirviendo los bytes por este endpoint, cada
 * lectura pasa por el token del analista y por su rol, y queda en el registro de acceso como
 * cualquier otra consulta a datos personales.
 *
 * ## Por qué NO lo puede llamar el cliente
 *
 * Los roles excluyen `customer` a propósito. Es una superficie de lectura de PII para operación, y
 * el titular ya ve sus propias fotos en la app desde su expediente.
 */
@ApiTags('customer-onboarding')
@ApiBearerAuth('access-token')
/*
 * Los guards, que faltaban.
 *
 * `@Roles(...)` de abajo sólo ESCRIBE metadata; quien la lee y decide es `RolesGuard`, y quien
 * puebla el `request.user` que ese guard compara es `JwtAuthGuard`. Sin la línea de guards este
 * backend no autentica por defecto —el único `APP_GUARD` global es el de rate limiting—, así que
 * los tres endpoints de abajo servían el carnet y la selfie de cualquier cliente A CUALQUIERA:
 * el decorador de roles quedaba como un comentario ejecutable.
 *
 * `TenantGuard` va en medio a propósito: `resolveCurrentTenant` acepta el tenant también por query
 * (una etiqueta `<img>` no puede mandar cabeceras), y sin este guard ese parámetro sería una
 * frontera que decide quien llama. Con él, si el token trae tenant, el valor recibido debe coincidir.
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')
@Controller('customer-onboarding')
export class CustomerEvidenceViewController {
  constructor(
    private readonly verificationRepository: CustomerVerificationRepository,
    private readonly storage: DocumentStorageService,
  ) {}

  /**
   * Los documentos a partir del ID de la VERIFICACION, no del cliente.
   *
   * El caso de revision manual vive en el motor y lo unico que conserva del expediente es el
   * `correlationId`, que es el id del intento de verificacion. Sin este salto, la pantalla del
   * analista no tiene forma de llegar a las imagenes: sabe que caso mira, pero no de quien es.
   */
  @ApiOperation({ summary: 'Documentos a partir del intento de verificacion' })
  @ApiResponse({ status: 200, description: 'Documentos del cliente dueno de esa verificacion.' })
  @ApiResponse({ status: 404, description: 'IDENTITY_ATTEMPT_NOT_FOUND.' })
  @Get('identity-verifications/:attemptId/evidence-documents')
  async byAttempt(@CurrentTenant() tenantId: string, @Param('attemptId') attemptId: string) {
    const customerId = await this.verificationRepository.findCustomerIdByAttempt(tenantId, attemptId);
    if (!customerId) throw new NotFoundException('IDENTITY_ATTEMPT_NOT_FOUND');
    return this.list(tenantId, { customerId } as OnboardingCustomerIdParamsDto);
  }

  @ApiOperation({ summary: 'Documentos de identidad subidos por el cliente' })
  @ApiParam({ name: 'customerId', schema: zodToApiSchemaSafe() })
  @ApiResponse({ status: 200, description: 'Lista de documentos con su tipo, tamaño y hash.' })
  @Get(':customerId/evidence-documents')
  async list(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
  ) {
    const documents = await this.verificationRepository.findEvidenceDocuments(tenantId, params.customerId);
    return {
      customerId: params.customerId,
      documents: documents.map((document) => ({
        documentId: String(document.id),
        documentType: document.documentType,
        mimeType: document.mimeType,
        sizeBytes: document.fileSizeBytes,
        // El hash es lo que permite comprobar que la imagen que se ve aquí es la misma que el motor
        // evaluó: su `input_snapshot_json` guarda ese mismo valor.
        sha256: document.fileHashSha256,
        uploadedAt: document.uploadedAt,
      })),
    };
  }

  @ApiOperation({ summary: 'Los bytes de un documento, para verlo' })
  @ApiResponse({ status: 200, description: 'La imagen.' })
  @ApiResponse({ status: 404, description: 'EVIDENCE_DOCUMENT_NOT_FOUND o el objeto ya no está.' })
  @Get(':customerId/evidence-documents/:documentId/content')
  @Header('Cache-Control', 'private, max-age=60')
  async content(
    /*
     * El tenant tambien se acepta por query.
     *
     * Esta ruta la consume una etiqueta `<img>`, y un `<img>` NO puede enviar cabeceras: solo tiene
     * una URL. Sin esta via, la unica forma de pintar la imagen seria descargarla por `fetch` y
     * convertirla en un blob —mas codigo y toda la imagen en memoria— o abrir la ruta sin tenant,
     * que es justo lo que no se debe hacer.
     *
     * No debilita nada: el guard de tenant sigue comprobando que coincida con el del token, y el
     * rol sigue siendo obligatorio. Solo cambia de donde se lee el mismo valor.
     */
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(onboardingCustomerIdParamsSchema)) params: OnboardingCustomerIdParamsDto,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const documents = await this.verificationRepository.findEvidenceDocuments(tenantId, params.customerId);
    const document = documents.find((item) => String(item.id) === documentId);
    if (!document) throw new NotFoundException('EVIDENCE_DOCUMENT_NOT_FOUND');

    // `s3Key` es nullable en el modelo: una fila sin objeto es un registro huerfano, no un 500.
    if (!document.s3Key) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');
    const bytes = await this.storage.readObject(document.s3Key);
    if (!bytes) throw new NotFoundException('EVIDENCE_OBJECT_NOT_FOUND');

    response.setHeader('Content-Type', document.mimeType ?? 'application/octet-stream');
    return new StreamableFile(bytes);
  }
}

/** El parámetro es el mismo de siempre; se extrae para no repetir el esquema en cada decorador. */
function zodToApiSchemaSafe() {
  return { type: 'string' as const, pattern: '^[1-9][0-9]*$' };
}
