/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Integraciones con terceros: catálogo, llamadas, respuestas, costos y salud (schema `integrations`). */
export const EXTERNAL_PROVIDER_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'data_providers',
    whyExists:
      'Atlas no genera todos los datos que necesita: los compra. Burós, verificación documental, reputación de IP, validación telefónica. Esta tabla es el registro de con quién trabaja el negocio, en qué categoría, si requiere consentimiento y si es caro.',
    whyNotDelete:
      'Es la puerta de control sobre el gasto y el cumplimiento en integraciones. Sin ella no se puede desactivar un proveedor caído sin desplegar código, ni saber qué llamadas exigen consentimiento o aprobación, ni negociar contratos con datos de uso reales.',
    decisionContribution:
      '`is_active`, `provider_status`, `default_mode`, `requires_consent`, `requires_manual_approval` e `is_costly` deciden en tiempo de ejecución si una consulta se hace, se hace en modo degradado o se bloquea. `reliability_score` gobierna el orden de fallback entre proveedores equivalentes.',
    usageExample:
      'El buró principal empieza a fallar. Se marca `provider_status = degraded` y el orquestador conmuta al proveedor secundario según confiabilidad, sin desplegar nada y sin frenar el onboarding.',
    systemsExplanation:
      'Catálogo en `integrations` con `provider_code` único, categoría, estado, modo por defecto, banderas de consentimiento y aprobación, y `default_retention_policy_id`. Lo lee `external-provider-registry.service.ts` para resolver el adaptador. Se cachea, así que un cambio de estado debe invalidar el cache o la conmutación no surte efecto. Las credenciales NO viven aquí: van en configuración/KMS.',
  },
  {
    tableName: 'data_provider_requests',
    whyExists:
      'Cada llamada a un tercero cuesta dinero, tarda, puede fallar y trata datos personales. Esta tabla registra cada una de esas llamadas: qué se pidió, para qué finalidad, con qué consentimiento, cuánto costó y cuánto tardó.',
    whyNotDelete:
      'Es la contabilidad y la auditoría de las integraciones. Sin ella no se puede conciliar la factura del proveedor, ni demostrar que la consulta tenía base legal, ni detectar consultas repetidas que se están pagando dos veces. Es también la evidencia de qué dato externo influyó en una decisión.',
    decisionContribution:
      'Habilita control de costo (`estimated_cost_amount`, `actual_cost_amount`, `cached_from_request_id`), control de abuso (límites por usuario y día), y decisiones operativas de retry y fallback a partir de `response_status`, `latency_ms` y `retry_of_request_id`.',
    usageExample:
      'Un analista intenta consultar buró por tercera vez para el mismo cliente en un día. La política de costo lo bloquea y el sistema devuelve la respuesta cacheada de la primera consulta, ahorrando el cargo y dejando registro de ambas cosas.',
    systemsExplanation:
      'Tabla append-only en `integrations` con `_tenant_id`, FKs a `data_providers`, `customers`, `risk_assessment_runs` y `customer_consents`. `idempotency_key` y `request_payload_hash` evitan duplicados; `provider_request_ref` permite reconciliar con el sistema del proveedor. Guarda `error_message_safe`, ya saneado: el mensaje crudo del proveedor puede contener PII y nunca debe persistirse ni loguearse tal cual.',
  },
  {
    tableName: 'data_provider_responses',
    whyExists:
      'Guarda lo que el tercero respondió. Es la evidencia externa sobre la que se aprobó, rechazó o escaló una decisión, y muchas veces es el dato más caro que tiene la organización.',
    whyNotDelete:
      'Sin la respuesta almacenada, una decisión basada en datos externos es irreconstruible: el proveedor no garantiza devolver lo mismo mañana. También se pierde la posibilidad de reprocesar sin volver a pagar, y de auditar que lo que dijo el buró es lo que el motor usó.',
    decisionContribution:
      'Su `normalized_payload_json` es lo que alimenta features y reglas; el payload crudo o redactado sostiene la auditoría. `retention_until` decide hasta cuándo puede seguir usándose antes de que la política obligue a purgarlo.',
    usageExample:
      'Un cliente impugna un rechazo por deuda reportada. Se recupera la respuesta del buró con su `response_hash`, se compara con lo que el motor usó y se confirma que el dato vino del tercero. El cliente es derivado al buró para corregir el origen.',
    systemsExplanation:
      'Tabla append-only en `integrations`, hija de `data_provider_requests`, con estrategia de almacenamiento explícita (`payload_storage_strategy`): JSON en base, versión redactada, o puntero a objeto en S3 para payloads grandes o muy sensibles. `contains_sensitive_data` y `retention_policy_id` gobiernan la purga. `response_hash` prueba integridad. La versión redactada es la única que puede exponerse al portal o a logs.',
  },
  {
    tableName: 'provider_health_logs',
    whyExists:
      'Registra el estado de salud de cada proveedor a lo largo del tiempo: si responde, con qué latencia y con qué errores. Es la base para reclamar SLA y para decidir a quién se le manda tráfico.',
    whyNotDelete:
      'Sin historial de salud, la conversación con un proveedor sobre incumplimientos es palabra contra palabra. También se pierde la correlación entre caídas del tercero y caídas de conversión propias, que es lo que explica un mal día de negocio.',
    decisionContribution:
      'Alimenta el circuit breaker y la selección de proveedor en tiempo real, y sostiene decisiones comerciales: renovar, renegociar o reemplazar según disponibilidad y latencia medidas, no según percepción.',
    usageExample:
      'El monitoreo muestra p95 de 8 segundos y 12% de error durante tres días en el proveedor principal. El tráfico se deriva al secundario y el registro se usa para exigir la compensación contractual por SLA incumplido.',
    systemsExplanation:
      'Tabla append-only en `integrations`, hija de `data_providers`, con `status`, `mode_checked`, `latency_ms`, `checked_at` y `error_message_safe`. La escriben tanto los health checks periódicos como las llamadas reales. Es de alto volumen y necesita retención con agregación: el detalle sirve semanas, la tendencia sirve años.',
  },
  {
    tableName: 'external_oauth_connections',
    whyExists:
      'Algunos enriquecimientos requieren que el propio cliente autorice el acceso a una cuenta externa suya. Esta tabla registra esas conexiones: qué proveedor, con qué alcances y en qué estado.',
    whyNotDelete:
      'Es la evidencia de que el cliente autorizó explícitamente el acceso y con qué alcance (`scopes_granted_json`). Sin ella no se puede probar el consentimiento otorgado en el flujo OAuth, ni revocar limpiamente, ni saber a qué cuentas externas sigue teniendo acceso el sistema.',
    decisionContribution:
      'Determina qué fuentes de enriquecimiento están disponibles para ese cliente y por cuánto tiempo (`token_expires_at`, `connection_status`). Una conexión desconectada debe cortar de inmediato el uso de esos datos en nuevas decisiones.',
    usageExample:
      'Un cliente conecta una cuenta externa para acreditar ingresos y meses después la desconecta. `disconnected_at` se llena, el enriquecimiento deja de ejecutarse y las features derivadas quedan marcadas como no renovables, sin borrar las decisiones ya tomadas.',
    systemsExplanation:
      'Tabla en `integrations` con `_tenant_id`, FK a `customers` y `data_providers`, `external_subject_hash` (identificador del usuario en el tercero, hasheado) y `token_reference`: una REFERENCIA al secreto en el almacén de credenciales, nunca el token. Guardar tokens OAuth en la base sería un incidente esperando ocurrir. La revocación debe borrar el secreto en el almacén, no solo marcar la fila.',
  },
  {
    tableName: 'external_provider_cost_policies',
    whyExists:
      'Convierte "cuidado con el gasto en proveedores" en reglas ejecutables: cuánto cuesta cada tipo de consulta, cuántas se permiten por usuario y por día, en qué etapas del flujo están habilitadas y cuáles exigen aprobación.',
    whyNotDelete:
      'Es el único freno automático al gasto en datos externos, que suele ser el mayor costo variable de un producto de riesgo. Sin ella, un bug o un abuso puede generar miles de consultas pagas antes de que alguien lo note en la factura del mes siguiente.',
    decisionContribution:
      'Decide, antes de cada llamada, si se ejecuta, si se sirve de cache (`cache_ttl_seconds`, `feature_ttl_seconds`), si requiere aprobación (`requires_manual_approval`, `requires_admin_role`) o si está bloqueada por defecto. También define la política de reintentos, que es donde el costo se multiplica sin querer.',
    usageExample:
      'La política del buró permite 2 consultas por usuario al día y bloquea la etapa de exploración. Un analista que intenta la tercera recibe un rechazo explicando el límite, y el intento queda registrado para el reporte de uso.',
    systemsExplanation:
      'Tabla en `integrations` hija de `data_providers`, con clave por (`provider_id`, `query_type`), vigencia (`active_from`/`active_to`), límites por usuario y globales, `allowed_decision_stages_json` y parámetros de cache y retry. La aplica `external-data-policy.util.ts` antes de ejecutar. `block_by_default = true` es la postura segura: lo que no está explícitamente permitido, no se gasta.',
  },
];
