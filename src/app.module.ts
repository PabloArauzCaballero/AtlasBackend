import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/sequelize.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
})
export class AppModule {}
