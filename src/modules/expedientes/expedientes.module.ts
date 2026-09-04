/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Reúne los archivos de una persona en una carpeta gobernable, con permisos y bitácora.
 * @system cablea el explorador de expedientes sobre el almacén y el catálogo ya existentes.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  CustomerReferenceContactModel,
  ExpedienteActividadModel,
  ExpedienteConcesionModel,
  ExpedienteModel,
  ExpedienteNodoModel,
  ExpedienteTicketSubidaModel,
  OnDeviceComputationRunModel,
  OnDeviceMetricValueModel,
} from '../../database/models/index.js';
import { FilesModule } from '../../common/files/files.module.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../common/storage/malware-scanner.service.js';
import { CustomersModule } from '../customers/customers.module.js';
import { InternalUsersModule } from '../internal-users/internal-users.module.js';
import { ExpedientesController } from './expedientes.controller.js';
import { ExpedientesNodosController } from './expedientes-nodos.controller.js';
import { ExpedientesContactosController } from './expedientes-contactos.controller.js';
import { ExpedientesConcesionesController } from './expedientes-concesiones.controller.js';
import { ExpedientesRepository } from './repositories/expedientes.repository.js';
import { ExpedienteAccesosRepository } from './repositories/expediente-accesos.repository.js';
import { ActorService } from './application/actor.service.js';
import { ConcesionService } from './application/concesion.service.js';
import { ContactosService } from './application/contactos.service.js';
import { ContenidoService } from './application/contenido.service.js';
import { ExpedienteHooksService } from './application/expediente-hooks.service.js';
import { ExpedienteService } from './application/expediente.service.js';
import { MaterializadorService } from './application/materializador.service.js';
import { NodoService } from './application/nodo.service.js';
import { NodoMovimientoService } from './application/nodo-movimiento.service.js';
import { ObjectRefCounterService } from './application/object-ref-counter.service.js';
import { SubidaService } from './application/subida.service.js';
import { ExpedienteAccesoGuard } from './guards/expediente-acceso.guard.js';
import { ExpedientesMantenimientoService } from './jobs/expedientes-mantenimiento.service.js';

/**
 * El explorador de archivos del cliente.
 *
 * ## Qué importa y por qué
 *
 * - `FilesModule` es el que verifica lo que se sube (tamaño, allowlist, bytes mágicos, antivirus).
 *   Existía completo desde hace meses y **ningún módulo lo consumía**; éste es su primer llamador
 *   real, y por eso el servicio de archivos deja de ser una capacidad sin salida.
 * - `CustomersModule` aporta los métodos de contacto. **No** se importa `CustomerOnboardingModule`:
 *   ese módulo necesita los ganchos de aquí, y depender el uno del otro sería un ciclo que Nest no
 *   resuelve sin `forwardRef`. Los agregados de la agenda se leen de sus modelos directamente.
 * - `InternalUsersModule` aporta el perfil de acceso: el token trae un rol heredado, y las
 *   concesiones se dan a roles internos reales.
 *
 * `ExpedienteService` se exporta para que los ganchos del onboarding y el flujo de supresión de
 * datos lo llamen sin importar el módulo entero.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      ExpedienteModel,
      ExpedienteNodoModel,
      ExpedienteConcesionModel,
      ExpedienteActividadModel,
      ExpedienteTicketSubidaModel,
      CustomerReferenceContactModel,
      OnDeviceComputationRunModel,
      OnDeviceMetricValueModel,
    ]),
    FilesModule,
    CustomersModule,
    InternalUsersModule,
  ],
  controllers: [
    ExpedientesController,
    ExpedientesNodosController,
    ExpedientesConcesionesController,
    ExpedientesContactosController,
  ],
  providers: [
    ExpedientesRepository,
    ExpedienteAccesosRepository,
    ActorService,
    ConcesionService,
    ContactosService,
    ContenidoService,
    ExpedienteService,
    ExpedienteHooksService,
    MaterializadorService,
    NodoService,
    NodoMovimientoService,
    ObjectRefCounterService,
    SubidaService,
    ExpedienteAccesoGuard,
    ExpedientesMantenimientoService,
    MalwareScannerService,
    DocumentStorageService,
  ],
  exports: [
    ExpedienteService,
    ExpedienteHooksService,
    ExpedientesMantenimientoService,
    NodoService,
    NodoMovimientoService,
    MaterializadorService,
    ExpedientesRepository,
    ActorService,
  ],
})
export class ExpedientesModule {}
