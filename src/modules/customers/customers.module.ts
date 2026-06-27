import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerContactMethodModel,
  CustomerModel,
  CustomerProfileVersionModel,
  CustomerStatusEventModel,
} from '../../database/models/index.js';
import { CustomersController } from './customers.controller.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [
    SequelizeModule.forFeature([
      CustomerModel,
      CustomerProfileVersionModel,
      CustomerStatusEventModel,
      CustomerContactMethodModel,
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
