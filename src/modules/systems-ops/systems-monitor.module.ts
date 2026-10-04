/**
 * @file Módulo del resumen de monitoreo.
 * @business Aparte de `SystemsOpsModule` a propósito: aquel lo importan también el worker y el planificador
 *   de runtime-jobs, y el resumen necesita el cliente del Motor y el dashboard de proveedores, que no
 *   tienen por qué cargarse en esos procesos. Sólo lo monta la API HTTP.
 */
import { Module } from '@nestjs/common';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module.js';
import { ExternalDataModule } from '../external-data/external-data.module.js';
import { SystemsMonitorController } from './systems-monitor.controller.js';
import { SystemsMonitorHostController } from './systems-monitor-host.controller.js';
import { SystemsMonitorHostStore } from './systems-monitor-host.store.js';
import { ExternalProviderDashboardService } from '../external-data/application/external-provider-dashboard.service.js';
import { OutcomeDispatchService } from '../decision-engine/outcome-dispatch.service.js';
import { MONITOR_OUTCOMES_PORT, MONITOR_PROVIDERS_PORT, SystemsMonitorSummaryService } from './systems-monitor-summary.service.js';
import { SystemsOpsModule } from './systems-ops.module.js';

@Module({
  imports: [SystemsOpsModule, DecisionEngineModule, ExternalDataModule],
  controllers: [SystemsMonitorController, SystemsMonitorHostController],
  providers: [
    SystemsMonitorSummaryService,
    SystemsMonitorHostStore,
    { provide: MONITOR_PROVIDERS_PORT, useExisting: ExternalProviderDashboardService },
    { provide: MONITOR_OUTCOMES_PORT, useExisting: OutcomeDispatchService },
  ],
})
export class SystemsMonitorModule {}
