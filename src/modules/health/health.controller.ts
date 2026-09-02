/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza permite retirar instancias enfermas antes de afectar a clientes u operadores.
 * @system expone liveness y readiness con estados HTTP útiles para orquestadores.
 */
import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator.js';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { buildInfo } from '../../config/build-info.js';
import { GracefulShutdownService } from '../../common/lifecycle/graceful-shutdown.service.js';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { isDedicatedReadConnection } from '../../config/database.config.js';
import { env } from '../../config/env.js';

type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  /** Commit del que se construyó la imagen. `null` si el pipeline no lo inyectó. */
  commit: string | null;
  /** Momento de construcción de la imagen. `null` si el pipeline no lo inyectó. */
  builtAt: string | null;
  database: 'ok' | 'unreachable';
  uptime: number;
  timestamp: string;
};

type DependencyState = 'ok' | 'unreachable' | 'not_configured';

type ReadinessStatus = {
  status: 'ready' | 'not_ready';
  checks: {
    postgres: DependencyState;
    /**
     * Pool de LECTURA dedicado (atlas_app_ro / réplica). `not_configured` cuando `DB_READ_ENABLED`
     * está apagado o degrada a las credenciales de escritura: ahí no hay una dependencia distinta
     * que comprobar.
     */
    postgresRead: DependencyState;
    redis: DependencyState;
  };
  /** `true` desde que llega SIGTERM: la instancia sigue sirviendo pero pide salir del balanceador. */
  shuttingDown: boolean;
  timestamp: string;
};

const REDIS_PING_TIMEOUT_MS = 2000;
const READ_POOL_PING_TIMEOUT_MS = 2000;

/**
 * Ejecuta un sondeo de dependencia con un techo de tiempo propio.
 *
 * Un probe debe responder rápido y mal antes que lento y bien. El caso que lo justifica es el pool
 * agotado: `authenticate()` se queda esperando una conexión hasta `DB_POOL_ACQUIRE_MS` (30 s por
 * defecto), y como el orquestador vuelve a sondear cada pocos segundos, los sondeos se acumulan en
 * la misma cola que el tráfico real. El probe pasa de detectar la saturación a alimentarla, y el
 * orquestador —que no recibe respuesta— acaba matando la instancia por timeout de probe sin que
 * nadie haya registrado por qué.
 *
 * Se resuelve a `unreachable` en vez de lanzar: quien llama quiere un estado, no una excepción.
 */
async function probeWithTimeout(probe: () => Promise<unknown>, timeoutMs: number): Promise<DependencyState> {
  const timedOut = Symbol('probe_timeout');
  try {
    const outcome = await Promise.race([
      probe().then(() => 'ok' as const),
      new Promise<typeof timedOut>((resolve) => {
        setTimeout(() => resolve(timedOut), timeoutMs).unref();
      }),
    ]);
    return outcome === timedOut ? 'unreachable' : 'ok';
  } catch {
    return 'unreachable';
  }
}

@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly shutdown: GracefulShutdownService,
    private readonly readQuery: ReadQueryService,
  ) {}

  @ApiOperation({
    summary: 'Health check del servicio (público, sin auth)',
    description: 'Verifica conectividad a la base de datos y reporta uptime/versión. No requiere autenticación.',
  })
  @ApiResponse({ status: 200, description: 'Servicio saludable o degradado (nunca falla por sí mismo).' })
  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    const dbStatus = await this.checkPostgres();
    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'atlas-backend',
      version: buildInfo.version,
      commit: buildInfo.commit,
      builtAt: buildInfo.builtAt,
      database: dbStatus,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @ApiOperation({
    summary: 'Liveness probe (¿el proceso está vivo?)',
    description: 'Trivial: si responde, el event loop atiende peticiones. No verifica dependencias.',
  })
  @ApiResponse({ status: 200, description: 'El proceso está vivo.' })
  @Public()
  @Get('liveness')
  @HttpCode(200)
  liveness(): { status: 'alive'; timestamp: string } {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  @ApiOperation({
    summary: 'Readiness probe (¿puede atender tráfico?)',
    description:
      'Verifica Postgres (obligatorio), el pool de lectura dedicado (informativo) y Redis (si está configurado). ' +
      'Devuelve 503 si Postgres no responde, para que el balanceador/orquestador saque la instancia del pool. ' +
      'Redis no configurado (dev) no falla.',
  })
  @ApiResponse({ status: 200, description: 'Listo para recibir tráfico.' })
  @ApiResponse({ status: 503, description: 'No listo: una dependencia obligatoria no responde.' })
  @Public()
  @Get('readiness')
  async readiness(): Promise<ReadinessStatus> {
    // El drenado se comprueba PRIMERO y sin tocar dependencias: durante el apagado la respuesta
    // debe ser inmediata y negativa, no depender de que Postgres conteste (hallazgo A-07).
    const shuttingDown = this.shutdown.isShuttingDown();
    const [postgres, postgresRead, redis] = shuttingDown
      ? (['ok', 'not_configured', 'not_configured'] as const)
      : await Promise.all([this.checkPostgres(), this.checkReadPool(), this.checkRedis()]);

    // `postgresRead` se REPORTA pero no decide el readiness, a diferencia de Postgres y Redis.
    // Razón: el pool de lectura es una dependencia COMPARTIDA por todas las instancias. Si la
    // réplica cae, marcar not_ready sacaría del balanceador a todo el despliegue —incluidos los
    // caminos de escritura, auth y onboarding, que siguen sanos— convirtiendo una degradación
    // parcial en una caída total. El operador ve el estado aquí y en /metrics; el orquestador no
    // actúa sobre él.
    const ready = !shuttingDown && postgres === 'ok' && redis !== 'unreachable';
    const body: ReadinessStatus = {
      status: ready ? 'ready' : 'not_ready',
      checks: { postgres, postgresRead, redis },
      shuttingDown,
      timestamp: new Date().toISOString(),
    };
    if (!ready) {
      /*
       * El 503 lleva `message`, y esa clave NO es decorativa.
       *
       * Antes se lanzaba `ServiceUnavailableException(body)` a secas, y `body` no tiene `message`:
       * `buildErrorMessage` del filtro global sólo mira `response.message`, así que al no
       * encontrarla caía al genérico y el cliente recibía «Error interno no controlado». Una sonda
       * de readiness que no dice QUÉ dependencia cayó obliga a entrar al contenedor a probar
       * Postgres y Redis a mano — que es exactamente el trabajo que esta respuesta existe para
       * ahorrar.
       *
       * Se nombran sólo las dependencias que DECIDEN el readiness. `postgresRead` se reporta en
       * `checks` pero no entra en el mensaje: no saca la instancia de rotación, y nombrarlo aquí
       * haría buscar una avería que no bloquea nada.
       *
       * No se filtra nada sensible: son nombres de dependencia y un estado, sin host, usuario ni
       * cadena de conexión — la misma regla que sigue `/health/data-sources`.
       */
      const caidas = [
        postgres !== 'ok' ? `postgres=${postgres}` : null,
        redis === 'unreachable' ? 'redis=unreachable' : null,
      ].filter((x): x is string => x !== null);
      throw new ServiceUnavailableException({
        ...body,
        message: shuttingDown
          ? 'La instancia está drenando y no debe recibir tráfico.'
          : `Dependencias no disponibles: ${caidas.join(', ')}.`,
      });
    }
    return body;
  }

  private async checkPostgres(): Promise<'ok' | 'unreachable'> {
    // El techo NO es opcional aquí: este es el único chequeo que decide el readiness, así que es el
    // que el orquestador espera. Ver `probeWithTimeout`.
    return probeWithTimeout(() => this.sequelize.authenticate(), env.HEALTH_DB_PING_TIMEOUT_MS) as Promise<'ok' | 'unreachable'>;
  }

  /**
   * Comprueba el pool de LECTURA solo cuando es una conexión distinta de la de escritura. Sin
   * `DB_READ_ENABLED` (o en modo degradado) el token apunta al pool de escritura: comprobarlo otra
   * vez no aportaría información y haría creer que hay dos dependencias sanas donde hay una.
   *
   * El timeout es obligatorio aunque el resultado sea informativo: una réplica colgada dejaría el
   * probe sin responder y el orquestador acabaría matando una instancia que sí puede servir.
   */
  private async checkReadPool(): Promise<DependencyState> {
    if (!isDedicatedReadConnection()) {
      return 'not_configured';
    }
    return probeWithTimeout(() => this.readQuery.getConnection().authenticate(), READ_POOL_PING_TIMEOUT_MS);
  }

  private async checkRedis(): Promise<DependencyState> {
    // Redis es opcional en dev (sin REDIS_URL el cliente es null); solo cuenta como fallo si está
    // configurado pero no responde. En prod env.ts ya exige REDIS_URL.
    if (!this.redis) {
      return 'not_configured';
    }
    const redis = this.redis;
    return probeWithTimeout(() => redis.ping(), REDIS_PING_TIMEOUT_MS);
  }
}
