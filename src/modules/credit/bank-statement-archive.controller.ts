/**
 * @file Controlador HTTP: expone los extractos bancarios del cliente por rutas versionadas.
 * @business «Mis datos» enseña los extractos que la persona subió y le deja descargar cada uno: son sus documentos.
 * @system valida la propiedad del recurso y delega en `BankStatementArchiveService`.
 */
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantGuard } from '../../common/guards/tenant.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../common/utils/auth/ownership.util.js';
import { BankStatementArchiveService } from './application/bank-statement-archive.service.js';
import { toBankStatementArchiveResponse } from './bank-statement.mapper.js';
import {
  BankStatementFileParamsDto,
  bankStatementFileParamsSchema,
  CreditCustomerIdParamsDto,
  creditCustomerIdParamsSchema,
} from './credit.schemas.js';

@ApiTags('credit')
@ApiBearerAuth('access-token')
@Controller('customers/:customerId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class BankStatementArchiveController {
  constructor(private readonly archive: BankStatementArchiveService) {}

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'Los extractos bancarios que subió el cliente',
    description:
      'Todos, del más reciente al más antiguo (hasta 24), cada uno con su estado, el banco y el período que se leyeron, ' +
      'y si el archivo se puede descargar todavía (`file.available`). `bank-statements/latest` sólo decía el estado del ' +
      'último; con esta ruta «Mis datos» enseña el historial completo.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiResponse({ status: 200, description: 'Extractos del cliente; `items` vacío si nunca subió ninguno.' })
  @Get('bank-statements')
  async list(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(creditCustomerIdParamsSchema)) params: CreditCustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    return toBankStatementArchiveResponse(await this.archive.list(tenantId, params.customerId));
  }

  @Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')
  @ApiOperation({
    summary: 'El PDF de un extracto bancario del cliente',
    description:
      'El archivo tal y como se subió. Sale por la API con la sesión del cliente y no por una URL del almacén: un ' +
      'enlace firmado se puede reenviar, una respuesta autenticada no.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: false, description: 'Opcional para `customer` (se toma del token).' })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'PDF del extracto.' })
  @ApiResponse({
    status: 404,
    description:
      'BANK_STATEMENT_NOT_FOUND — no existe o no es de este cliente. BANK_STATEMENT_FILE_NOT_AVAILABLE — es suyo, pero el archivo ya no está en el almacén.',
  })
  @Get('bank-statements/:reviewId/file')
  async file(
    @CurrentTenant() tenantId: string,
    @Param(new ZodValidationPipe(bankStatementFileParamsSchema)) params: BankStatementFileParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ) {
    assertOwnCustomerResourceOrInternalOperational(currentUser, params.customerId);
    const { pdf, fileName } = await this.archive.file(tenantId, params.customerId, params.reviewId);

    // `inline`, como el informe de gastos: la app lo abre en su visor y desde ahí se guarda o se comparte.
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `inline; filename="${fileName}"`);
    response.setHeader('content-length', String(pdf.length));
    // Es un documento bancario personal: ni el navegador ni un proxy deben guardarlo.
    response.setHeader('cache-control', 'private, no-store');
    response.end(pdf);
  }
}
