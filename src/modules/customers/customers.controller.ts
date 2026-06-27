import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { parsePositiveId } from '../../common/utils/ids/id.util.js';
import { CustomersService } from './customers.service.js';
import { customerIdParamsSchema, CustomerIdParamsDto, RegisterCustomerDto, registerCustomerSchema } from './customers.schemas.js';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Public()
  @Post('register')
  registerCustomer(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Body(new ZodValidationPipe(registerCustomerSchema)) body: RegisterCustomerDto,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? ''), 'x-tenant-id');
    return this.customersService.registerCustomer(tenantId, body);
  }

  @Get(':customerId/summary')
  getCustomerSummary(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Param(new ZodValidationPipe(customerIdParamsSchema)) params: CustomerIdParamsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const tenantId = parsePositiveId(String(tenantIdHeader ?? currentUser.tenantId ?? ''), 'x-tenant-id');
    return this.customersService.getCustomerSummary(tenantId, params.customerId, currentUser);
  }
}
