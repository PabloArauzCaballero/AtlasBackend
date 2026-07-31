/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
export type SystemsPagedResponse<T> = {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type SystemsHealthStatus = {
  code: string;
  name: string;
  status: string;
  isConfigured: boolean;
  missingEnvVars: string[];
  isCritical: boolean;
  isWorker: boolean;
  checkType: 'LIVE' | 'CONFIGURATION' | 'NOT_APPLICABLE';
  isHealthy: boolean | null;
  healthMessage: string;
};
