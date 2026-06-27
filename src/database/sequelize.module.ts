import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { buildSequelizeOptions } from '../config/database.config.js';

@Module({
  imports: [SequelizeModule.forRoot(buildSequelizeOptions())],
})
export class DatabaseModule {}
