/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { Module } from '@nestjs/common';
import { AdminReadController } from './admin-read.controller.js';
import { AdminReadService } from './application/admin-read.service.js';
import { InternalPortalController } from './internal-portal.controller.js';
import { InternalPortalService } from './internal-portal.service.js';

@Module({
  controllers: [InternalPortalController, AdminReadController],
  providers: [InternalPortalService, AdminReadService],
})
export class InternalPortalModule {}
