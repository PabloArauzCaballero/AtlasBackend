/**
 * @file Middleware HTTP: activa el contexto QA de una petición SÓLO con credencial firmada.
 * @business Esta pieza hace que las llamadas al mock de una corrida QA lleguen con SU namespace, y
 *   que una cabecera inventada por un cliente público no active nada.
 * @system verifica la firma, el entorno, el tenant y que la corrida siga viva; el `runToken` del
 *   mock sale del registro cifrado de la corrida, nunca de la petición.
 *
 * Lo que NO hace: autenticar al actor de negocio. La credencial QA viaja junto al bearer de la
 * persona, no en su lugar; la ruta sigue exigiendo su sesión como a cualquiera.
 */
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { decryptSecret } from '../../../common/utils/crypto/secret-box.util.js';
import {
  deploymentEnvironment,
  qaExecutionAllowed,
  QA_EXECUTION_HEADER,
  runWithQaContext,
  verifyQaCredential,
  type ActiveQaContext,
} from '../../../platform/security/qa-execution-context.js';
import { QaRunSupportRepository } from './qa-run-support.repository.js';
import { QaRunWorkerRepository } from './qa-run-worker.repository.js';

/** `mockRunId` es el namespace de la corrida en el mock; la credencial nombra la corrida por su id. */
type CachedRun = { runToken: string | null; epoch: string | null; live: boolean; tenantId: string; mockRunId: string; until: number };

const CACHE_MS = 10_000;
const LIVE = new Set(['RUNNING', 'CANCELLING']);

@Injectable()
export class QaContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(QaContextMiddleware.name);
  private readonly cache = new Map<string, CachedRun>();

  constructor(
    private readonly runs: QaRunWorkerRepository,
    private readonly support: QaRunSupportRepository,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const header = request.headers[QA_EXECUTION_HEADER];
    // La cabecera se retira siempre: ningún controlador ni log posterior tiene por qué verla.
    delete request.headers[QA_EXECUTION_HEADER];
    const secret = process.env.QA_EXECUTION_SECRET;
    if (typeof header !== 'string' || !secret || !qaExecutionAllowed()) return next();

    const verdict = verifyQaCredential(header, secret, deploymentEnvironment());
    if (!verdict.ok) {
      this.logger.warn(`Credencial QA rechazada (${verdict.code}); la petición sigue sin contexto QA.`);
      return next();
    }
    const claims = verdict.claims;
    const tenantHeader = request.headers['x-tenant-id'];
    if (typeof tenantHeader === 'string' && tenantHeader !== claims.tenantId) return next();

    let run: CachedRun | null;
    try {
      run = await this.resolveRun(claims.runId);
    } catch (error) {
      // Sin registro no hay contexto: la petición sigue, pero sin etiquetar, y la reconciliación lo
      // verá como tráfico sin namespace en vez de como evidencia válida.
      this.logger.warn(`No se pudo resolver la corrida QA ${claims.runId}: ${(error as Error).message}`);
      return next();
    }
    if (!run || !run.live || run.tenantId !== claims.tenantId || !run.runToken) return next();
    const context: ActiveQaContext = {
      tenantId: claims.tenantId,
      runId: run.mockRunId,
      runToken: run.runToken,
      personaKey: claims.personaKey,
      logicalOperationId: claims.logicalOperationId,
      attempt: claims.attempt,
      epoch: run.epoch ?? undefined,
    };
    runWithQaContext(context, () => next());
  }

  private async resolveRun(runId: string): Promise<CachedRun | null> {
    const cached = this.cache.get(runId);
    if (cached && cached.until > Date.now()) return cached;
    const [run, secret] = await Promise.all([this.runs.loadRun(runId), this.support.readSecret(runId)]);
    if (!run) return null;
    const entry: CachedRun = {
      runToken: secret?.token ? decryptSecret(secret.token) : null,
      epoch: secret?.epoch ?? null,
      live: LIVE.has(run.status),
      tenantId: String(run._tenant_id),
      mockRunId: run.namespace,
      until: Date.now() + CACHE_MS,
    };
    this.cache.set(runId, entry);
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return entry;
  }
}
