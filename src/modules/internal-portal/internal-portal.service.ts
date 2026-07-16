import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Query, Row } from './application/portal-format.util.js';
import { PortalDataQualityService } from './application/portal-data-quality.service.js';
import { PortalGlossaryService } from './application/portal-glossary.service.js';
import { PortalGovernanceService } from './application/portal-governance.service.js';
import { PortalLineageService } from './application/portal-lineage.service.js';
import { PortalOperationsService } from './application/portal-operations.service.js';
import { PortalReportsService } from './application/portal-reports.service.js';
import { PortalSearchService } from './application/portal-search.service.js';

/**
 * Fachada del portal interno (Fase 2.2 del plan 10/10).
 *
 * Este archivo tenía 1341 líneas y mezclaba glosario, gobierno, calidad, linaje, alertas, jobs,
 * reportes y búsqueda en una sola clase. Ahora cada dominio vive en `application/` y esta clase solo
 * delega, conservando **exactamente** la misma API pública (ver
 * `test/unit/internal-portal/internal-portal-service-contract.spec.ts`).
 *
 * Los colaboradores se construyen aquí en vez de inyectarse por DI a propósito: comparten la única
 * dependencia real (la conexión Sequelize) y así el controller, el módulo y los tests existentes —que
 * construyen el servicio con un doble de `sequelize`— siguen funcionando sin cambios. Cada
 * colaborador es, además, testeable de forma aislada.
 */
@Injectable()
export class InternalPortalService {
  private readonly glossary: PortalGlossaryService;
  private readonly dataQuality: PortalDataQualityService;
  private readonly governance: PortalGovernanceService;
  private readonly lineage: PortalLineageService;
  private readonly operations: PortalOperationsService;
  private readonly reports: PortalReportsService;
  private readonly searchService: PortalSearchService;

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {
    this.glossary = new PortalGlossaryService(this.sequelize);
    this.dataQuality = new PortalDataQualityService(this.sequelize);
    this.governance = new PortalGovernanceService(this.sequelize);
    this.lineage = new PortalLineageService(this.sequelize);
    this.operations = new PortalOperationsService(this.sequelize);
    this.reports = new PortalReportsService(this.sequelize, this.operations);
    this.searchService = new PortalSearchService(this.sequelize);
  }

  // --- Glosario de negocio ---------------------------------------------------
  listBusinessTerms(query: Query) {
    return this.glossary.listBusinessTerms(query);
  }

  getBusinessTerm(termId: string) {
    return this.glossary.getBusinessTerm(termId);
  }

  // --- Exports ---------------------------------------------------------------
  listExports(query: Query) {
    return this.reports.listExports(query);
  }

  getExport(exportId: string) {
    return this.reports.getExport(exportId);
  }

  // --- Calidad de datos ------------------------------------------------------
  listDataQualityRules(query: Query) {
    return this.dataQuality.listDataQualityRules(query);
  }

  getDataQualityRule(ruleId: string) {
    return this.dataQuality.getDataQualityRule(ruleId);
  }

  runDataQualityRule(ruleId: string) {
    return this.dataQuality.runDataQualityRule(ruleId);
  }

  // --- Gobierno --------------------------------------------------------------
  getGovernancePolicy(policyIdValue: string) {
    return this.governance.getGovernancePolicy(policyIdValue);
  }

  updateGovernancePolicy(policyIdValue: string, body: Row) {
    return this.governance.updateGovernancePolicy(policyIdValue, body);
  }

  // --- Linaje ----------------------------------------------------------------
  getLineage(query: Query) {
    return this.lineage.getLineage(query);
  }

  getLineageNode(nodeId: string) {
    return this.lineage.getLineageNode(nodeId);
  }

  getLineageImpact(query: Query) {
    return this.lineage.getLineageImpact(query);
  }

  // --- Alertas ---------------------------------------------------------------
  listAlerts(query: Query) {
    return this.operations.listAlerts(query);
  }

  acknowledgeAlert(alertId: string) {
    return this.operations.acknowledgeAlert(alertId);
  }

  // --- Jobs ------------------------------------------------------------------
  listJobs(query: Query) {
    return this.operations.listJobs(query);
  }

  getJob(jobRunId: string) {
    return this.operations.getJob(jobRunId);
  }

  retryJob(jobRunId: string) {
    return this.operations.retryJob(jobRunId);
  }

  cancelJob(jobRunId: string) {
    return this.operations.cancelJob(jobRunId);
  }

  // --- Release readiness -----------------------------------------------------
  getReleaseReadiness() {
    return this.reports.getReleaseReadiness();
  }

  // --- Reportes --------------------------------------------------------------
  listReports(query: Query) {
    return this.reports.listReports(query);
  }

  getReport(reportId: string) {
    return this.reports.getReport(reportId);
  }

  runReport(reportId: string, body: Row) {
    return this.reports.runReport(reportId, body);
  }

  listReportSnapshots(reportId: string, query: Query) {
    return this.reports.listReportSnapshots(reportId, query);
  }

  // --- Búsqueda --------------------------------------------------------------
  search(query: Query) {
    return this.searchService.search(query);
  }
}
