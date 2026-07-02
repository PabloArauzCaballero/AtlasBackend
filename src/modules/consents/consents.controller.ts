import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { ConsentsService } from './consents.service.js';
import { listActiveConsentDocumentsQuerySchema, ListActiveConsentDocumentsQueryDto } from './consents.schemas.js';

@ApiTags('consents')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Public()
  @Get('consent-documents/active')
  listActiveDocuments(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Query(new ZodValidationPipe(listActiveConsentDocumentsQuerySchema)) query: ListActiveConsentDocumentsQueryDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.consentsService.listActiveDocuments(tenantId, query);
  }
}
