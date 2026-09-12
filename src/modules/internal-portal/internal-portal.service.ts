/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Query, Row } from './application/portal-format.util.js';
import { PortalScope } from './application/portal-scope.util.js';
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
  listDataQualityRules(scope: PortalScope, query: Query) {
    return this.dataQuality.listDataQualityRules(scope, query);
  }

  getDataQualityRule(scope: PortalScope, ruleId: string) {
    return this.dataQuality.getDataQualityRule(scope, ruleId);
  }

  // --- Gobierno --------------------------------------------------------------
  getGovernancePolicy(policyIdValue: string) {
    return this.governance.getGovernancePolicy(policyIdValue);
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
  listAlerts(scope: PortalScope, query: Query) {
    return this.operations.listAlerts(scope, query);
  }

  acknowledgeAlert(scope: PortalScope, alertId: string) {
    return this.operations.acknowledgeAlert(scope, alertId);
  }

  // --- Jobs ------------------------------------------------------------------
  listJobs(scope: PortalScope, query: Query) {
    return this.operations.listJobs(scope, query);
  }

  getJob(scope: PortalScope, jobRunId: string) {
    return this.operations.getJob(scope, jobRunId);
  }

  // --- Release readiness -----------------------------------------------------
  getReleaseReadiness(scope: PortalScope) {
    return this.reports.getReleaseReadiness(scope);
  }

  // --- Reportes --------------------------------------------------------------
  listReports(query: Query) {
    return this.reports.listReports(query);
  }

  getReport(reportId: string) {
    return this.reports.getReport(reportId);
  }

  runReport(scope: PortalScope, reportId: string, body: Row) {
    return this.reports.runReport(scope, reportId, body);
  }

  // --- Búsqueda --------------------------------------------------------------
  search(query: Query) {
    return this.searchService.search(query);
  }
}
