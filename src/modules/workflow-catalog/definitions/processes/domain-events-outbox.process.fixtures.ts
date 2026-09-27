/**
 * @file Proceso declarado en código: Eventos de dominio: outbox, relay, inbox y reintentos.
 * @business Un hecho de negocio (un pago confirmado, un caso escalado) tiene que llegar a quien debe enterarse aunque el proceso muera a la mitad; el outbox lo garantiza sin perder ni duplicar avisos.
 * @system fixture P-32 que `syncWorkflowCatalog` vuelca a `workflow_*`; `outbox_events` escrito en la transacción del servicio, `process_events`/`process_outbox`/`reclaim_stuck_events`/`purge_processed_outbox` y `events.controller.ts`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** Roles de clase de `EventsController`. */
const EVENTS_ROLES = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'];

export const DOMAIN_EVENTS_OUTBOX: WorkflowDefinitionFixture = {
  processId: 'P-32',
  code: 'domain_events_outbox',
  version: 'v1',
  name: 'Eventos de dominio: outbox, relay, inbox y reintentos',
  description:
    'Cómo viaja un evento de dominio: el servicio lo escribe en outbox_events dentro de su propia transacción, los jobs lo reclaman con lease y lo despachan a cada consumidor con recibo de inbox, reintentan con espera creciente, rescatan lo atascado y purgan lo ya procesado; el operador lo sigue y lo reintenta o cancela desde el portal.',
  processType: 'system_job',
  ownerDomain: 'platform',
  ownerRole: 'SYSTEMS_ADMIN',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Desacopla los procesos de negocio y permite reintentos auditables sin perder eventos: si el evento se escribe en la misma transacción que el cambio, no hay pago confirmado sin su evento ni evento de un pago que no ocurrió, y un consumidor que ya lo procesó no lo repite.',
    whoStartsAndCloses:
      'Lo inicia cualquier servicio de negocio al escribir en outbox_events; lo cierran los jobs process_events y process_outbox al despacharlo, o un operador interno que lo reintenta o cancela desde «Eventos». Nadie lo inicia a mano salvo la publicación manual de un operador.',
    startAndEnd:
      'Empieza con la fila en pending dentro de la transacción del servicio y termina en processed (con recibo en inbox_receipts por consumidor), en failed tras agotar max_attempts, o en cancelled por un operador; la purga borra lo procesado pasado su período de retención.',
    whenItFails:
      'Un fallo reintenta con espera de attempts² minutos (tope 60) y al agotar intentos pasa a failed, que es la cola de muertos; si el proceso muere a mitad, reclaim_stuck_events rescata lo que quedó en processing. Un evento sin registro lo marca procesado process_outbox sin avisar a nadie: esa es la trampa conocida.',
    healthIndicator:
      'Filas en pending y processing más viejas que el intervalo del job, filas en failed, y para los avisos la prueba real: notification_messages.outbox_event_id con una entrega sent o delivered; «Trabajo pendiente» de Flujos lo da por código de evento.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'platform_ops',
    table: 'outbox_events',
    idColumn: '_id',
    statusColumn: 'status',
    labelColumn: 'event_code',
    openStatuses: ['pending', 'processing', 'failed'],
  },
  success: 'Cada evento llega a sus consumidores una sola vez y queda processed con su recibo de inbox.',
  failure: 'El evento se queda en failed o atascado en processing, o se marca procesado sin que nadie se entere.',
  sources: [
    'src/modules/events/events.controller.ts',
    'src/modules/events/events.service.ts',
    'src/platform/events/outbox-relay.service.ts',
    'src/modules/runtime-jobs/scheduled-jobs.catalog.ts',
    'src/database/models/outbox-events.model.ts',
    'memoria atlas-eventos-de-dominio-sin-aviso',
    'memoria atlas-flujos-revision-humana',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-32)',
  ],
  stages: [
    {
      code: 'outbox_write',
      name: 'Escritura en el outbox',
      description: 'El servicio de negocio escribe el evento en outbox_events en la misma transacción que el cambio que lo origina.',
      module: 'events',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      resultingStates: ['pending'],
      steps: [
        {
          code: 'outbox.write_in_transaction',
          name: 'Escribir el evento en la transacción del servicio',
          description: 'sequelize-outbox-writer inserta la fila con event_code, aggregate, correlation_id e idempotency_key.',
          kind: 'event',
          reason: 'No es una llamada: lo escribe el propio servicio de negocio dentro de su transacción (patrón outbox transaccional).',
          resultingStates: ['pending'],
        },
        {
          code: 'outbox.manual_publish',
          name: 'Publicar un evento a mano',
          description: 'Un operador o un sistema publica un evento registrado; EventsService rechaza los códigos sin registro.',
          method: 'POST',
          path: '/operations/events',
          roles: EVENTS_ROLES,
          optional: true,
          resultingStates: ['pending'],
        },
      ],
    },
    {
      code: 'outbox_dispatch',
      name: 'Reclamo y despacho',
      description:
        'process_events reclama los códigos del registro con lease y owner_token y despacha a cada consumidor con recibo de inbox; process_outbox atiende los que no están en el registro.',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      requiredStates: ['pending'],
      resultingStates: ['processing', 'processed', 'failed'],
      steps: [
        {
          code: 'outbox.process_events',
          name: 'Despachar eventos registrados',
          description:
            'Reclama con FOR UPDATE SKIP LOCKED, publica fuera de la transacción de reclamo y cierra sólo si el owner_token sigue siendo suyo.',
          kind: 'job',
          job: 'process_events',
          resultingStates: ['processed', 'failed'],
        },
        {
          code: 'outbox.process_outbox',
          name: 'Drenar el resto del outbox',
          description: 'Job de compatibilidad para los códigos que no están en EVENT_REGISTRY: los marca procesados sin aviso.',
          kind: 'job',
          job: 'process_outbox',
        },
      ],
    },
    {
      code: 'outbox_recovery',
      name: 'Rescate de atascados',
      description: 'Devuelve a pending los eventos que quedaron en processing porque el proceso murió a la mitad.',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      requiredStates: ['processing'],
      resultingStates: ['pending'],
      steps: [
        {
          code: 'outbox.reclaim_stuck',
          name: 'Rescatar eventos atascados',
          description: 'Sin este job, lo que queda en processing no lo mira ninguna consulta de reclamo y se pierde en silencio.',
          kind: 'job',
          job: 'reclaim_stuck_events',
        },
      ],
    },
    {
      code: 'outbox_operator_follow_up',
      name: 'Seguimiento del operador',
      description: 'El operador consulta los eventos, ve el catálogo y reintenta o cancela los que fallaron.',
      module: 'events',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/events',
      optional: true,
      roles: EVENTS_ROLES,
      steps: [
        {
          code: 'outbox.list',
          name: 'Listar eventos',
          description: 'Eventos por estado, código y fecha.',
          method: 'GET',
          path: '/operations/events',
          roles: EVENTS_ROLES,
        },
        {
          code: 'outbox.catalog',
          name: 'Ver el catálogo de eventos',
          description: 'Códigos del registro con su familia.',
          method: 'GET',
          path: '/operations/events/catalog',
          roles: EVENTS_ROLES,
          optional: true,
        },
        {
          code: 'outbox.detail',
          name: 'Ver un evento',
          description: 'Carga, intentos, último error y fechas.',
          method: 'GET',
          path: '/operations/events/:eventId',
          roles: EVENTS_ROLES,
        },
        {
          code: 'outbox.retry',
          name: 'Reintentar un evento',
          description: 'Vuelve a pending con attempts a cero, para que no caiga en failed al primer fallo.',
          method: 'POST',
          path: '/operations/events/:eventId/retry',
          roles: EVENTS_ROLES,
          optional: true,
          requiredStates: ['failed'],
          resultingStates: ['pending'],
        },
        {
          code: 'outbox.cancel',
          name: 'Cancelar un evento',
          description: 'Lo deja en cancelled; 409 EVENT_ALREADY_CANCELLED si ya lo estaba.',
          method: 'POST',
          path: '/operations/events/:eventId/cancel',
          roles: EVENTS_ROLES,
          optional: true,
          resultingStates: ['cancelled'],
          errors: ['409 EVENT_ALREADY_CANCELLED'],
        },
      ],
    },
    {
      code: 'outbox_purge',
      name: 'Purga de lo procesado',
      description: 'Borra las filas processed pasado su período de retención, para que el outbox no crezca para siempre.',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      terminal: true,
      requiredStates: ['processed'],
      steps: [
        {
          code: 'outbox.purge_processed',
          name: 'Purgar el outbox procesado',
          description: 'Retención RUNTIME_JOBS_OUTBOX_RETENTION_DAYS, en tandas de 1.000.',
          kind: 'job',
          job: 'purge_processed_outbox',
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'El inventario dice PENDING/PROCESSING/DISPATCHED/FAILED/DEAD; el código usa pending/processing/processed/failed/cancelled (failed es la cola de muertos).',
      '108 eventos en event-registry.ts sin esquema de payload; catalog.event_definitions sembrado con 10 códigos que no coinciden.',
      'Un evento sin registro lo traga process_outbox sin avisar a nadie.',
    ],
  },
};
