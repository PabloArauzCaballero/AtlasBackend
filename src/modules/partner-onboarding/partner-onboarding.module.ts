/**
 * @file Módulo NestJS: declara el límite de inyección y sus dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system declara el límite de inyección del expediente del partner y sus adaptadores.
 */
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../common/storage/malware-scanner.service.js';
import {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerProfileModel,
  PartnerQrCodeModel,
} from '../../database/models/index.js';
import { PartnerCommerceService } from './application/partner-commerce.service.js';
import { PartnerContactVerificationService } from './application/partner-contact-verification.service.js';
import { PartnerProfileService } from './application/partner-profile.service.js';
import { PartnerQrService } from './application/partner-qr.service.js';
import { MailSenderModule } from '../mail-sender/mail-sender.module.js';
import { MerchantQrController } from './merchant-qr.controller.js';
import { PartnerCommerceController } from './partner-commerce.controller.js';
import { PartnerOnboardingController } from './partner-onboarding.controller.js';
import { PartnerOperationsController } from './partner-operations.controller.js';
import { PartnerOnboardingRepository } from './partner-onboarding.repository.js';
import { PartnerOwnershipGuard } from './partner-ownership.guard.js';

/**
 * El expediente verificable del comercio (ADR-0009).
 *
 * Módulo paralelo al del consumidor y no una generalización de aquél: la cadena de verificación
 * del cliente está atada a `customer` en sus modelos y en sus servicios, y tocarla para que sirva
 * a dos sujetos pondría en riesgo el KYC que hoy sostiene producción. Aquí sólo se reutiliza lo
 * que ya es genérico: el almacenamiento de evidencia y las métricas.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      PartnerProfileModel,
      PartnerLegalRepresentativeModel,
      PartnerBranchModel,
      PartnerQrCodeModel,
      PartnerPosTerminalModel,
    ]),
    // El canal de correo, que es lo que hace posible probar el contacto declarado.
    MailSenderModule,
  ],
  controllers: [PartnerOnboardingController, PartnerCommerceController, MerchantQrController, PartnerOperationsController],
  providers: [
    PartnerOnboardingRepository,
    // Guard de propiedad de los controladores: Nest lo instancia por el contenedor porque
    // necesita el repositorio para resolver quién es el dueño del expediente.
    PartnerOwnershipGuard,
    PartnerProfileService,
    PartnerCommerceService,
    PartnerQrService,
    PartnerContactVerificationService,
    DocumentStorageService,
    // `DocumentStorageService` lo exige en su constructor: la evidencia se analiza antes de darse
    // por buena. Faltaba aquí y el contenedor no arrancaba — lo detectó levantar la API de verdad,
    // no el type-check.
    MalwareScannerService,
    /*
     * `MetricsService` NO se provee aquí: `ObservabilityModule` es `@Global` y ya lo exporta.
     * Declararlo en este módulo creaba una SEGUNDA instancia con su propio `Registry`, así que los
     * contadores del embudo se incrementaban en un registro que `/metrics` no renderiza nunca —el
     * endpoint mostraba el HELP y el TYPE sin una sola muestra—. Se detectó raspando /metrics
     * después del smoke; ningún test lo habría visto.
     */
  ],
  exports: [PartnerProfileService, PartnerCommerceService, PartnerQrService],
})
export class PartnerOnboardingModule {}
