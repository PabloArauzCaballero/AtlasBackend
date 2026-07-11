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
  checkType: 'LIVE' | 'CONFIGURATION';
  isHealthy: boolean | null;
  healthMessage: string;
};
