/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de observability sin introducir reglas de un dominio específico.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service.js';

/** Forma mínima del pool de `sequelize-pool` que se necesita leer. No es API pública de Sequelize. */
type PoolStats = { size?: number; available?: number; using?: number; waiting?: number };

/**
 * Publica la ocupación del pool de conexiones a PostgreSQL.
 *
 * Hallazgo A-10 de `docs/audit/auditoria-integral-2026-07-30.md`: las métricas cubrían latencia y
 * tasa de error HTTP, pero no la causa más común de que ambas se degraden en un backend Sequelize —
 * quedarse sin conexiones. Con `waiting > 0` sostenido, los requests se encolan esperando una
 * conexión y la latencia sube sin que ninguna query sea lenta: sin esta serie, el síntoma es
 * visible y la causa no.
 *
 * Se lee en el momento del scrape (callback `collect` de prom-client) en vez de por temporizador:
 * son contadores en memoria, leerlos no cuesta nada, y así el valor corresponde exactamente al
 * instante que Prometheus registra.
 *
 * El acceso a `connectionManager.pool` toca interno de Sequelize (no hay API pública para esto), así
 * que va acotado a este archivo y protegido: si una versión futura cambia la forma, la métrica se
 * queda sin publicar pero nada más se rompe.
 */
@Injectable()
export class DbPoolMetricsService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const readPool = (): PoolStats | null => {
      try {
        const manager = this.sequelize.connectionManager as unknown as { pool?: PoolStats };
        return manager.pool ?? null;
      } catch {
        return null;
      }
    };

    new Gauge({
      name: 'atlas_db_pool_connections',
      help: 'Conexiones del pool PostgreSQL por estado: total (size), libres (available), en uso (using) y peticiones encoladas esperando una conexión (waiting).',
      labelNames: ['state'],
      registers: [this.metrics.registry],
      collect(): void {
        const pool = readPool();
        if (!pool) return;
        this.set({ state: 'size' }, pool.size ?? 0);
        this.set({ state: 'available' }, pool.available ?? 0);
        this.set({ state: 'using' }, pool.using ?? 0);
        this.set({ state: 'waiting' }, pool.waiting ?? 0);
      },
    });
  }
}
