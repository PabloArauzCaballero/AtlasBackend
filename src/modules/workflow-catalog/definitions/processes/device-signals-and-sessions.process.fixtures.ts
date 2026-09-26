/**
 * @file Proceso declarado en código: señales del dispositivo — agenda, ubicación, sesiones y telemetría.
 * @business Las señales del teléfono (quién es el dispositivo, dónde está, qué agenda tiene, cómo se usa la app) alimentan fraude y riesgo; este proceso las recoge sólo con consentimiento y cierra las sesiones que nadie cerró.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; rutas de `sessions`, `customer-device-signals`, `customer-telemetry`, `customer-privacy` y `operations`, y el job `expire_stale_sessions`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

const SESSION_ROLES = [
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'admin',
  'platform_admin',
  'system',
];
const SIGNAL_ROLES = ['customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin'];
const INVESTIGATION_ROLES = ['internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin'];

export const DEVICE_SIGNALS_AND_SESSIONS: WorkflowDefinitionFixture = {
  processId: 'P-15',
  code: 'device_signals_and_sessions',
  version: 'v1',
  name: 'Señales del dispositivo: agenda, ubicación, sesiones y telemetría',
  description:
    'El cliente decide si comparte agenda y ubicación; la app abre y cierra sesiones, envía telemetría, el resumen agregado de contactos y, con consentimiento, la agenda completa y el rastro de ubicación. Un job caduca las sesiones abiertas y fraude lo investiga desde el portal.',
  processType: 'system_job',
  ownerDomain: 'device_telemetry',
  ownerRole: 'FRAUD_ANALYST',
  priority: 'P1',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Fraude y riesgo necesitan saber qué dispositivo usa la persona, si su ubicación simulada o real cuadra con su domicilio y cómo usa la app. Este proceso recoge esas señales sólo con consentimiento propio, cifra la agenda porque sus contactos no consintieron nada y calcula la distancia en el servidor para no enseñar al teléfono dónde decir que está.',
    whoStartsAndCloses:
      'Lo inicia el cliente al decidir en la pantalla de permisos si comparte agenda y ubicación, y cada vez que abre la app (sesión). Lo cierra la propia app al terminar la sesión o, si no lo hace, el job que caduca sesiones; fraude y operaciones lo consultan desde las pantallas de investigación.',
    startAndEnd:
      'Empieza con las decisiones de consentimiento `device_address_book` y `location_tracking` y el inicio de sesión (`active`). Termina con la sesión `ended` por la app o `expired` por el job, y con los datos guardados: agenda cifrada, rastro de ubicación, telemetría y resumen agregado de contactos.',
    whenItFails:
      'Sin consentimiento vigente la agenda y la ubicación responden 422 CONSENT_NOT_GRANTED; un dispositivo o sesión ajenos, 403. Si la app no cierra la sesión queda abierta hasta el job, que caduca por hora de INICIO y no por último latido (la app no envía latidos). Fraude se entera sólo mirando las pantallas de investigación: el resumen de comportamiento no tiene pantalla.',
    healthIndicator:
      'Sesiones `active` con más antigüedad que el máximo de inactividad (120 minutos por defecto) deberían ser cero tras cada pasada del job; además, proporción de clientes con consentimiento de ubicación que tienen puntos recientes en `telemetry.customer_location_pings`.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'telemetry',
    table: 'customer_sessions',
    idColumn: '_id',
    statusColumn: 'session_status',
    openStatuses: ['active'],
  },
  success: 'Las señales llegan con consentimiento, cada sesión termina (por la app o por el job) y fraude puede investigarlas.',
  failure: 'Señales rechazadas por falta de consentimiento o dispositivo ajeno, o sesiones que quedan abiertas hasta caducar.',
  sources: [
    'src/modules/sessions/sessions.controller.ts',
    'src/modules/sessions/application/session-heartbeat.service.ts',
    'src/modules/sessions/application/session-end.service.ts',
    'src/modules/customer-device-signals/customer-device-signals.controller.ts',
    'src/modules/customer-device-signals/application/device-signals-access.service.ts',
    'src/modules/customer-telemetry/customer-telemetry.service.ts',
    'src/modules/customer-onboarding/customer-packages.controller.ts',
    'src/modules/operations/operations.controller.ts',
    'src/modules/runtime-jobs/runtime-jobs.service.ts',
    'src/modules/runtime-jobs/scheduled-jobs.catalog.ts',
    'src/config/env.runtime-jobs.schema.ts',
    'AtlasFrontend/apps/consumer-app/src/session/device-signals.ts',
    'AtlasFrontend/apps/consumer-app/src/session/session.tsx',
    'AtlasAdminPortal/src/features/operations-sessions/services.ts',
    'AtlasAdminPortal/src/features/operations-cases/services.ts',
    'AtlasAdminPortal/src/features/runtime-jobs/runtime-job-catalog.ts',
    'memoria atlas-agenda-del-dispositivo',
    'memoria atlas-rastreo-de-ubicacion',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/cableado.json',
  ],
  metadata: {
    inventoryStatesMismatch:
      'El inventario da active/expired/revoked; el código escribe active, ended (la app cierra) y expired (el job). Ningún código escribe revoked.',
    expiryByStart: 'expire_stale_sessions filtra por started_at < ahora − maxIdleMinutes, no por el último latido.',
  },
  stages: [
    {
      code: 'signals_consent',
      name: 'Consentimiento de agenda y ubicación',
      description:
        'La pantalla de permisos recoge dos decisiones (dos permisos del sistema distintos) y la app las registra como consentimientos con el documento vigente de cada finalidad.',
      module: 'customer_privacy',
      actor: 'customer',
      client: 'CONSUMER_APP',
      screen: '/permisos',
      entry: true,
      steps: [
        {
          code: 'sig.consent_decisions',
          name: 'Registrar las decisiones de agenda y ubicación',
          description:
            'Una decisión `granted` o `declined` por finalidad (`device_address_book`, `location_tracking`), con el id del documento publicado.',
          method: 'POST',
          path: '/customers/:customerId/privacy/consent-decisions',
          roles: ['customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin'],
          input: { decisions: '[{ consentDocumentId, purposeCode, decision, decidedAt }]' },
          successStatus: [200, 201],
        },
      ],
    },
    {
      code: 'signals_session_open',
      name: 'Apertura de sesión',
      description: 'Al entrar, la app abre la sesión y vincula el dispositivo; un cliente bloqueado no abre sesión.',
      module: 'sessions',
      actor: 'customer',
      client: 'CONSUMER_APP',
      resultingStates: ['active'],
      steps: [
        {
          code: 'sig.session_start',
          description:
            'Abre la sesión del cliente al entrar en la app y vincula el dispositivo. Un cliente bloqueado no puede abrir sesión.',
          name: 'Abrir la sesión',
          method: 'POST',
          path: '/customers/:customerId/sessions/start',
          roles: SESSION_ROLES,
          idempotencyKey: true,
          resultingStates: ['active'],
          errors: ['400 falta X-Idempotency-Key', '404 cliente no encontrado', '422 CUSTOMER_BLOCKED'],
          successStatus: [200, 201],
        },
        {
          code: 'sig.session_heartbeat',
          name: 'Latido de sesión',
          description: 'Existe y valida dispositivo y sesión, pero la app no lo llama (triaje de cableado, categoría D).',
          method: 'POST',
          path: '/customers/:customerId/sessions/:sessionId/heartbeat',
          roles: SESSION_ROLES,
          idempotencyKey: true,
          optional: true,
          repeatable: true,
          errors: ['422 SESSION_NOT_ACTIVE', '403 el dispositivo no corresponde a la sesión'],
        },
        {
          code: 'sig.session_state',
          name: 'Estado de la sesión del cliente',
          description: 'Ruta sin llamador hoy (triaje de cableado, categoría D).',
          method: 'GET',
          path: '/customers/:customerId/session-state',
          roles: SESSION_ROLES,
          optional: true,
        },
      ],
    },
    {
      code: 'signals_collection',
      name: 'Envío de señales desde el teléfono',
      description:
        'Telemetría de uso por lotes; resumen agregado de contactos (siempre, sin nombres ni teléfonos); y, sólo con consentimiento, la agenda completa cifrada y el rastro de ubicación (5 min en primer plano, 15 min y 100 m en segundo).',
      module: 'customer_device_signals',
      actor: 'customer',
      client: 'CONSUMER_APP',
      steps: [
        {
          code: 'sig.telemetry_batch',
          description:
            'Recibe por lotes los eventos y métricas de uso de la app, comprobando que dispositivo y sesión son del cliente. Nunca admite contactos en claro.',
          name: 'Enviar un lote de telemetría',
          method: 'POST',
          path: '/customers/:customerId/telemetry/batch',
          roles: SIGNAL_ROLES,
          idempotencyKey: true,
          repeatable: true,
          errors: ['400 lote vacío', '413 PAYLOAD_TOO_LARGE', '422 RAW_CONTACTS_NOT_ALLOWED', '403 dispositivo o sesión ajenos'],
        },
        {
          code: 'sig.contacts_snapshot',
          name: 'Resumen agregado de contactos',
          description:
            'Cuentas y proporciones más hashes de un solo uso que el servidor cruza con listas de vigilancia y referencias, y descarta. Lo envía la pantalla de referencias.',
          method: 'POST',
          path: '/customer-onboarding/:customerId/contacts-snapshot',
          roles: SIGNAL_ROLES,
        },
        {
          code: 'sig.address_book_sync',
          name: 'Sincronizar la agenda completa',
          description:
            'Guarda cada contacto cifrado en `customer.customer_device_contacts`; distingue acceso limitado de iOS (`accessScope: limited`).',
          method: 'POST',
          path: '/customers/:customerId/address-book',
          roles: SIGNAL_ROLES,
          optional: true,
          repeatable: true,
          errors: ['422 CONSENT_NOT_GRANTED: device_address_book', '403 dispositivo no vinculado'],
        },
        {
          code: 'sig.location_pings',
          name: 'Enviar puntos de ubicación',
          description:
            'Serie temporal con la hora del teléfono; el reenvío de un lote ya recibido no duplica. La distancia al domicilio se calcula en el servidor.',
          method: 'POST',
          path: '/customers/:customerId/location-pings',
          roles: SIGNAL_ROLES,
          optional: true,
          repeatable: true,
          errors: ['422 CONSENT_NOT_GRANTED: location_tracking', '403 sesión ajena'],
        },
      ],
    },
    {
      code: 'signals_withdrawal',
      name: 'Retirada de la agenda',
      description:
        'Al retirar el consentimiento de agenda, la app pide el borrado y el servidor borra físicamente los contactos, que es lo que promete el texto del consentimiento.',
      module: 'customer_device_signals',
      actor: 'customer',
      client: 'CONSUMER_APP',
      optional: true,
      steps: [
        {
          code: 'sig.address_book_purge',
          description:
            'Borra físicamente la agenda guardada del cliente cuando retira el consentimiento, como promete el texto del consentimiento.',
          name: 'Borrar la agenda guardada',
          method: 'DELETE',
          path: '/customers/:customerId/address-book',
          roles: SIGNAL_ROLES,
          optional: true,
          output: { deleted: 'number', purgedAt: 'string' },
        },
      ],
    },
    {
      code: 'signals_session_close',
      name: 'Cierre de sesión por la app',
      description: 'La app cierra la sesión saliente al terminar o cambiar de cuenta; la sesión pasa a `ended`.',
      module: 'sessions',
      actor: 'customer',
      client: 'CONSUMER_APP',
      requiredStates: ['active'],
      resultingStates: ['ended'],
      steps: [
        {
          code: 'sig.session_end',
          description: 'Cierra la sesión activa cuando el cliente sale o cambia de cuenta, y la deja en estado ended.',
          name: 'Cerrar la sesión',
          method: 'POST',
          path: '/customers/:customerId/sessions/:sessionId/end',
          roles: SESSION_ROLES,
          idempotencyKey: true,
          requiredStates: ['active'],
          resultingStates: ['ended'],
          errors: ['404 sesión no encontrada', '422 SESSION_NOT_ACTIVE', '403 el dispositivo no corresponde a la sesión'],
        },
      ],
    },
    {
      code: 'signals_session_expiry',
      name: 'Caducidad de sesiones abiertas',
      description:
        'Cada intervalo (5 minutos por defecto) el job marca `expired` las sesiones `active` iniciadas hace más del máximo de inactividad (120 minutos por defecto).',
      module: 'runtime_jobs',
      actor: 'system',
      client: 'BLOCK',
      terminal: true,
      requiredStates: ['active'],
      resultingStates: ['expired'],
      steps: [
        {
          code: 'sig.expire_sessions_job',
          description:
            'Cada intervalo marca como expired las sesiones activas iniciadas hace más del máximo de inactividad, para que ninguna quede abierta indefinidamente.',
          name: 'Caducar sesiones',
          kind: 'job',
          job: 'expire_stale_sessions',
          resultingStates: ['expired'],
        },
      ],
    },
    {
      code: 'signals_expiry_manual',
      name: 'Caducar sesiones a mano',
      description: 'Desde «Jobs de ejecución» un administrador adelanta la pasada del job, con opción de ensayo sin escribir.',
      module: 'runtime_jobs',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/runtime-jobs',
      optional: true,
      roles: ['admin', 'platform_admin'],
      steps: [
        {
          code: 'sig.expire_sessions_manual',
          description:
            'Adelanta a mano la caducidad de sesiones desde «Jobs de ejecución», con opción de ensayo que sólo cuenta sin escribir.',
          name: 'Lanzar la caducidad de sesiones',
          method: 'POST',
          path: '/operations/jobs/expire-stale-sessions',
          roles: ['admin', 'platform_admin', 'system'],
          input: { maxIdleMinutes: 'number', dryRun: 'boolean' },
          optional: true,
        },
      ],
    },
    {
      code: 'signals_session_investigation',
      name: 'Investigación de una sesión',
      description:
        'Fraude y operaciones revisan una sesión concreta. Las coordenadas GPS no se devuelven al portal, sólo si hubo observación.',
      module: 'sessions',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/sessions/[sessionId]/investigation-summary',
      roles: ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin'],
      steps: [
        {
          code: 'sig.session_investigation',
          description: 'Devuelve el resumen de investigación de una sesión para fraude y operaciones, sin exponer las coordenadas GPS.',
          name: 'Resumen de investigación de la sesión',
          method: 'GET',
          path: '/operations/sessions/:sessionId/investigation-summary',
          roles: ['internal_operator', 'risk_analyst', 'compliance_analyst', 'fraud_analyst', 'admin', 'platform_admin', 'system'],
        },
      ],
    },
    {
      code: 'signals_customer_investigation',
      name: 'Investigación del cliente',
      description: 'Resumen de investigación del cliente, abierto desde su ficha en operaciones.',
      module: 'operations',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/operations/customers/[customerId]/investigation-summary',
      optional: true,
      roles: INVESTIGATION_ROLES,
      steps: [
        {
          code: 'sig.customer_investigation',
          description: 'Devuelve el resumen de investigación de un cliente para la pantalla de investigación de operaciones.',
          name: 'Resumen de investigación del cliente',
          method: 'GET',
          path: '/operations/customers/:customerId/investigation-summary',
          roles: INVESTIGATION_ROLES,
          optional: true,
        },
      ],
    },
    {
      code: 'signals_behavior_summary',
      name: 'Resumen de comportamiento',
      description:
        'Resumen del uso de la app por el cliente. La ruta existe y ninguna pantalla la llama (triaje de cableado, categoría D).',
      module: 'operations',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      optional: true,
      roles: INVESTIGATION_ROLES,
      steps: [
        {
          code: 'sig.behavior_summary',
          description: 'Devuelve el resumen de comportamiento del cliente en la app. La ruta existe y ninguna pantalla la llama.',
          name: 'Leer el resumen de comportamiento',
          method: 'GET',
          path: '/operations/customers/:customerId/behavior-summary',
          roles: INVESTIGATION_ROLES,
          optional: true,
        },
      ],
    },
  ],
  transitions: [
    { code: 'sig.entry', from: null, to: 'sig.consent_decisions', condition: 'always', isDefault: true },
    { code: 'sig.consent_to_session', from: 'sig.consent_decisions', to: 'sig.session_start', condition: 'on_success', isDefault: true },
    { code: 'sig.session_to_telemetry', from: 'sig.session_start', to: 'sig.telemetry_batch', condition: 'on_success', isDefault: true },
    { code: 'sig.telemetry_to_snapshot', from: 'sig.telemetry_batch', to: 'sig.contacts_snapshot', condition: 'always', isDefault: true },
    {
      code: 'sig.snapshot_to_address_book',
      from: 'sig.contacts_snapshot',
      to: 'sig.address_book_sync',
      condition: 'conditional',
      expression: { consent: 'device_address_book' },
      description: 'Sólo con consentimiento de agenda.',
    },
    {
      code: 'sig.snapshot_to_location',
      from: 'sig.contacts_snapshot',
      to: 'sig.location_pings',
      condition: 'conditional',
      expression: { consent: 'location_tracking' },
      description: 'Sólo con consentimiento de ubicación.',
    },
    { code: 'sig.snapshot_to_end', from: 'sig.contacts_snapshot', to: 'sig.session_end', condition: 'always', isDefault: true },
    {
      code: 'sig.address_book_withdraw',
      from: 'sig.address_book_sync',
      to: 'sig.address_book_purge',
      condition: 'conditional',
      expression: { consentWithdrawn: true },
    },
    {
      code: 'sig.no_end_to_expiry',
      from: 'sig.session_start',
      to: 'sig.expire_sessions_job',
      condition: 'conditional',
      expression: { endedByApp: false },
    },
    { code: 'sig.end_exit', from: 'sig.session_end', to: null, condition: 'on_success', isDefault: true },
    { code: 'sig.expiry_exit', from: 'sig.expire_sessions_job', to: null, condition: 'always' },
  ],
  dependencies: [
    {
      step: 'sig.address_book_sync',
      dependsOn: 'sig.consent_decisions',
      type: 'requires_completion',
      description: 'Sin consentimiento `device_address_book` responde 422.',
    },
    {
      step: 'sig.location_pings',
      dependsOn: 'sig.consent_decisions',
      type: 'requires_completion',
      description: 'Sin consentimiento `location_tracking` responde 422.',
    },
    { step: 'sig.session_end', dependsOn: 'sig.session_start', type: 'requires_data', description: 'Se cierra la sesión que se abrió.' },
    {
      step: 'sig.telemetry_batch',
      dependsOn: 'sig.session_start',
      type: 'soft',
      description: 'Una sesión ajena al cliente se rechaza con 403.',
    },
  ],
};
