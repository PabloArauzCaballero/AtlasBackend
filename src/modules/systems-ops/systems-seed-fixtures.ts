/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { CURATED_BUSINESS_ENDPOINTS } from './systems-seed-fixtures.business.js';
import { CURATED_PLATFORM_ENDPOINTS } from './systems-seed-fixtures.platform.js';
import type { EndpointSeed } from './systems-ops.types.js';

export const CURATED_ENDPOINTS: EndpointSeed[] = [...CURATED_PLATFORM_ENDPOINTS, ...CURATED_BUSINESS_ENDPOINTS];

export type StressProfileSeed = {
  method: string;
  path: string;
  name: string;
  targetRps: number;
  durationSeconds: number;
  concurrency: number;
  maxP95Ms?: number;
  maxErrorRate?: number;
};

export const STRESS_PROFILE_SEEDS: StressProfileSeed[] = [
  {
    method: 'GET',
    path: '/api/v1/health',
    name: 'Healthcheck concurrente',
    targetRps: 80,
    durationSeconds: 60,
    concurrency: 40,
    maxP95Ms: 400,
  },
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    name: 'Login externo bajo carga controlada',
    targetRps: 25,
    durationSeconds: 60,
    concurrency: 20,
    maxP95Ms: 900,
  },
  {
    method: 'POST',
    path: '/api/v1/internal/auth/login',
    name: 'Login panel interno bajo carga',
    targetRps: 20,
    durationSeconds: 60,
    concurrency: 15,
    maxP95Ms: 900,
  },
  {
    method: 'POST',
    path: '/api/v1/customer-onboarding/start',
    name: 'Onboarding start bajo carga',
    targetRps: 10,
    durationSeconds: 60,
    concurrency: 10,
    maxP95Ms: 1500,
  },
  {
    method: 'POST',
    path: '/api/v1/customers/:customerId/risk-assessments',
    name: 'Risk assessment sintético',
    targetRps: 5,
    durationSeconds: 60,
    concurrency: 5,
    maxP95Ms: 1800,
  },
  {
    method: 'GET',
    path: '/api/v1/operations/work-queue',
    name: 'Work queue lectura concurrente',
    targetRps: 30,
    durationSeconds: 60,
    concurrency: 20,
    maxP95Ms: 900,
  },
  {
    method: 'GET',
    path: '/api/v1/systems/endpoints',
    name: 'Catálogo endpoints lectura concurrente',
    targetRps: 35,
    durationSeconds: 60,
    concurrency: 20,
    maxP95Ms: 900,
  },
  {
    method: 'GET',
    path: '/api/v1/systems/data-entities',
    name: 'Catálogo entidades lectura concurrente',
    targetRps: 25,
    durationSeconds: 60,
    concurrency: 15,
    maxP95Ms: 1000,
  },
  {
    method: 'GET',
    path: '/api/v1/operations/catalogs',
    name: 'Catálogos negocio lectura concurrente',
    targetRps: 25,
    durationSeconds: 60,
    concurrency: 15,
    maxP95Ms: 1000,
  },
  {
    method: 'GET',
    path: '/api/v1/external-data/providers/health',
    name: 'Salud proveedores lectura concurrente',
    targetRps: 20,
    durationSeconds: 60,
    concurrency: 10,
    maxP95Ms: 1000,
  },
];
