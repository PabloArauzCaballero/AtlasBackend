/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace que el indicador de backlog del outbox mida lo mismo que el consumidor toma.
 * @system cuenta los pendientes de un inquilino y los sin inquilino por separado, y los publica.
 */
import { Op } from 'sequelize';

/** Etiqueta con la que se publica el backlog sin inquilino. Una sola serie, no una por inquilino. */
export const OUTBOX_SIN_INQUILINO = 'sin_inquilino';

export interface OutboxBacklog {
  /** Pendientes del inquilino de la corrida. */
  tenant: number;
  /** Pendientes sin inquilino: las mutaciones anónimas (login, refresh, logout). */
  withoutTenant: number;
}

type ContadorOutbox = { count(options: unknown): Promise<number> };
type MetricaBacklog = { setOutboxPendingEvents(input: { tenantId: string; pending: number }): void } | undefined;

/**
 * Las dos poblaciones que toma `process_outbox`, contadas APARTE.
 *
 * Cuando el consumidor empezó a reclamar los eventos sin inquilino (`f263d37`), las cuentas que lo
 * acompañan siguieron siendo sólo del inquilino. Dos consecuencias, señaladas por otra sesión:
 * en seco, `skippedBusinessEvents` restaba dos poblaciones distintas y podía salir negativo; y el
 * indicador de backlog —el que tendría que haber delatado tres semanas de eventos huérfanos— seguía
 * sin verlos. Se había cambiado un silencio por otro.
 */
export async function countOutboxBacklog(outbox: ContadorOutbox, tenantId: string): Promise<OutboxBacklog> {
  // Igual que la reclamación, `COALESCE(available_at, now()) <= now()`: un `available_at` nulo cuenta como
  // disponible. Sin esto las dos cifras medían poblaciones distintas y la resta en seco podía salir negativa.
  const disponible = { status: 'pending', [Op.or]: [{ availableAt: null }, { availableAt: { [Op.lte]: new Date() } }] };
  const [tenant, withoutTenant] = await Promise.all([
    outbox.count({ where: { ...disponible, tenantId } as never }),
    outbox.count({ where: { ...disponible, tenantId: null } as never }),
  ]);
  return { tenant, withoutTenant };
}

/**
 * Publica el backlog en dos series: la del inquilino y una única `sin_inquilino`.
 *
 * El indicador es un gauge que se FIJA, no que se suma: cada corrida de cada inquilino escribe el
 * mismo valor en la serie `sin_inquilino`, así que con N inquilinos no aparece N veces. Sumarlo a la
 * serie de cada inquilino sí lo habría contado N veces.
 */
export function publishOutboxBacklog(metrics: MetricaBacklog, tenantId: string, backlog: OutboxBacklog): void {
  metrics?.setOutboxPendingEvents({ tenantId, pending: backlog.tenant });
  metrics?.setOutboxPendingEvents({ tenantId: OUTBOX_SIN_INQUILINO, pending: backlog.withoutTenant });
}
