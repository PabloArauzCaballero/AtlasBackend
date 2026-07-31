/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Flujo de alta, comportamiento durante el onboarding y proyecciones de actividad (schema `telemetry`). */
export const ONBOARDING_BEHAVIOR_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'onboarding_flows',
    whyExists:
      'El alta de un cliente es un embudo con etapas, y el negocio pierde dinero en cada punto donde la gente abandona. Esta tabla es la unidad de análisis de ese embudo: un intento de alta, cuándo empezó, cómo terminó y cuánto duró.',
    whyNotDelete:
      'Sin ella no existe medición de conversión ni de abandono, que es el indicador comercial más importante de un producto de onboarding digital. También se pierde el contenedor al que se cuelgan los eventos de paso, el comportamiento y las señales de bot.',
    decisionContribution:
      'Decide dónde invertir en producto (qué paso rediseñar), permite comparar versiones de flujo (`flow_version`) con datos reales, y aporta al riesgo: un flujo completado en 40 segundos o abandonado y reiniciado ocho veces no se trata como uno normal.',
    usageExample:
      'La v2 del flujo muestra 38% de abandono en el paso de selfie contra 12% de la v1. Producto revierte el cambio de ese paso y la conversión se recupera, con evidencia y no con opinión.',
    systemsExplanation:
      'Tabla en `telemetry` con `_tenant_id`, ligada a cliente y sesión, con `started_at`, `completed_at`, `abandoned_at`, `completion_status` y `total_duration_seconds` denormalizado para no recalcularlo en cada reporte. Es la raíz de `onboarding_step_events`, `form_field_interaction_events`, `permission_events` y `onboarding_behavior_summaries`; el cierre del flujo debe consolidar duración y estado en una sola transacción.',
  },
  {
    tableName: 'onboarding_step_events',
    whyExists:
      'Registra cada paso del alta: cuándo empezó, cuándo terminó, cuánto tardó y cuántos errores hubo. Es la radiografía fina del embudo que `onboarding_flows` resume.',
    whyNotDelete:
      'Es lo único que permite pasar de "la gente abandona" a "la gente abandona en el paso de dirección porque tarda 90 segundos y falla dos veces". Sin el detalle por paso, la optimización del producto es adivinanza.',
    decisionContribution:
      'Prioriza el trabajo de producto con datos, y aporta señales antifraude: pasos completados con tiempos imposibles para un humano, o una secuencia de pasos fuera de orden, indican automatización.',
    usageExample:
      'El paso `UPLOAD_ID` concentra `error_count` alto y duración mediana de 2 minutos. Se descubre que la validación de tamaño de imagen rechaza fotos de teléfonos comunes; se corrige y el abandono en ese paso cae a la mitad.',
    systemsExplanation:
      'Tabla append-only y de alto volumen en `telemetry`, hija de `onboarding_flows`, con `step_code`, `event_type`, tiempos, `duration_ms` y `payload_json`. El `payload_json` debe pasar por redacción antes de persistirse: es una vía fácil de filtrar PII sin darse cuenta. Requiere índice por (`onboarding_flow_id`, `started_at`) y retención acotada.',
  },
  {
    tableName: 'form_field_interaction_events',
    whyExists:
      'Observa cómo el usuario llena el formulario: si pega el texto en lugar de escribirlo, cuántas veces corrige un campo, cuánto tiempo lo tiene enfocado. Un humano legítimo y un script llenan formularios de manera muy distinta.',
    whyNotDelete:
      'Es la fuente de las señales de comportamiento más difíciles de falsificar. Sin ella se pierde la detección temprana de bots y de digitación asistida, y también la evidencia de UX sobre qué campos confunden a la gente.',
    decisionContribution:
      'Alimenta el `bot_likelihood_score` y el score de comportamiento. `used_copy_paste` sobre un campo de número de documento, junto con tiempo de foco casi nulo, sugiere que quien llena el formulario no es el titular de ese documento.',
    usageExample:
      'Una solicitud llega con copy-paste en nombre, documento y fecha de nacimiento, y menos de 300 ms de foco en cada campo. El indicador de bot sube, el caso no se aprueba solo y pasa a verificación reforzada.',
    systemsExplanation:
      'Tabla append-only de altísimo volumen en `telemetry`, hija de `onboarding_flows`, con `field_code`, `interaction_type`, `used_copy_paste`, `correction_count` y `focus_duration_ms`. Nunca guarda el CONTENIDO del campo, solo la metadata de la interacción: esa es la línea que la mantiene fuera del terreno de PII. Es candidata natural a agregación temprana y retención corta.',
  },
  {
    tableName: 'permission_events',
    whyExists:
      'Registra qué permisos del sistema operativo (ubicación, contactos, notificaciones) se pidieron al usuario y qué respondió. El negocio necesita saber a qué señales tiene acceso y cuáles el usuario negó.',
    whyNotDelete:
      'Es la prueba de que el permiso se solicitó y de que la respuesta fue la que fue. Sin ella, usar datos de ubicación o contactos queda sin respaldo, y tampoco se puede explicar por qué a un cliente le faltan features que otro sí tiene.',
    decisionContribution:
      'El patrón de concesión (`permission_grant_score`) es en sí mismo una señal de riesgo y de intención: quien niega todos los permisos entrega menos evidencia y suele evaluarse de forma más conservadora. También decide qué features son computables para ese cliente.',
    usageExample:
      'Un cliente niega ubicación y contactos. El sistema no puede calcular consistencia de domicilio ni solapamiento de contactos, así que la evaluación se apoya más en documento y dispositivo, y el límite inicial ofrecido es menor.',
    systemsExplanation:
      'Tabla append-only en `telemetry`, ligada a cliente, sesión y flujo, con `permission_code`, `requested_at`, `granted` y `responded_at`. Es evidencia de cumplimiento y se cruza con `customer_consents`: el permiso del sistema operativo no sustituye al consentimiento legal, se necesitan ambos y el código debe verificar los dos antes de capturar.',
  },
  {
    tableName: 'onboarding_behavior_summaries',
    whyExists:
      'Condensa todo el comportamiento de un onboarding en un puñado de indicadores usables: tiempo total, tasa de error, copy-paste, abandonos previos, score de permisos y probabilidad de bot. Es la versión que el motor de riesgo puede consumir sin recorrer millones de eventos.',
    whyNotDelete:
      'Es la capa que hace que las señales de comportamiento sean utilizables en tiempo real. Sin ella, cada evaluación tendría que agregar eventos crudos en línea, con una latencia que ningún flujo de alta tolera, y se perdería la comparabilidad entre casos.',
    decisionContribution:
      '`bot_likelihood_score`, `form_error_rate` y `abandonment_count_prior` entran directamente al score y a las reglas. `behavior_cluster_code` permite tratar segmentos distintos con políticas distintas en lugar de un umbral único para todos.',
    usageExample:
      'Un caso con `bot_likelihood_score = 0.88`, `ci_copy_paste_detected = true` y tres abandonos previos activa la regla de automatización sospechosa. Se exige verificación en vivo antes de continuar y el caso queda etiquetado para el análisis semanal de fraude.',
    systemsExplanation:
      'Tabla de proyección en `telemetry`, una fila por flujo de onboarding, recalculada por un job. `computation_version` es obligatorio: sin él es imposible saber si dos resúmenes son comparables o si uno se calculó con una fórmula anterior. Es derivada, así que puede reconstruirse desde los eventos crudos mientras estos existan; una vez purgados los eventos, esta tabla pasa a ser la única memoria del comportamiento.',
  },
  {
    tableName: 'customer_activity_summaries',
    whyExists:
      'Es la ficha operativa del cliente: primera y última sesión, dispositivo habitual, cuántos dispositivos vio, logins fallidos recientes, nivel de riesgo actual, casos de fraude y revisiones abiertas. Responde de un vistazo "¿cómo está este cliente?".',
    whyNotDelete:
      'Es lo que hace que las pantallas operativas y las reglas en línea sean rápidas. Sin esta proyección, cada consulta de soporte o cada regla tendría que agregar sesiones, dispositivos y casos en tiempo real, con una latencia inaceptable en un flujo de compra.',
    decisionContribution:
      'Concentra los contadores que más pesan en decisiones inmediatas: `failed_login_count_7d`, `device_change_count_30d`, `suspicious_ip_count_30d`, `watchlist_hit_count_lifetime`, `fraud_case_count_lifetime`, `open_manual_review_count`. Un cliente con revisión abierta no debería recibir aprobación automática, y esto lo resuelve en una sola lectura.',
    usageExample:
      'En el punto de venta, la regla lee la ficha: `current_trust_tier = low`, `device_change_count_30d = 4` y una revisión manual abierta. La operación se deriva a autorización manual en lugar de aprobarse en dos segundos.',
    systemsExplanation:
      'Tabla de proyección en `telemetry` con PK igual a `customer_id` (una fila por cliente), recalculada por job y por eventos. `recomputed_at` y `computation_version` son imprescindibles para saber cuán fresca y cuán comparable es la fila. Es un caché derivado: si se corrompe, se reconstruye desde las tablas fuente, y ninguna decisión legalmente relevante debería apoyarse solo en ella sin verificar el dato original.',
  },
  {
    tableName: 'customer_action_logs',
    whyExists:
      'Es la telemetría de producto del lado del cliente: qué pantalla vio, qué acción ejecutó, cuándo. Permite entender el uso real de la app más allá del onboarding.',
    whyNotDelete:
      'Es la memoria del comportamiento en la app. Sin ella no se puede reconstruir qué hizo un usuario antes de un incidente, ni analizar adopción de funcionalidades, ni distinguir un usuario activo de uno que instaló y nunca volvió.',
    decisionContribution:
      'Aporta señales de engagement que alimentan riesgo (un cliente que solo abre la app para pedir crédito y desaparece) y decisiones de producto sobre qué construir. También sirve de contexto en investigaciones: qué pantallas recorrió antes de una operación disputada.',
    usageExample:
      'Ante una compra disputada, el log muestra que la sesión recorrió catálogo, carrito y confirmación con tiempos humanos normales, lo que respalda que la operación fue del titular y no un scripted takeover.',
    systemsExplanation:
      'Tabla append-only de muy alto volumen en `telemetry`, ligada a cliente, sesión y dispositivo, con `event_name`, `screen_name`, `action_payload_json` y `occurred_at`. `action_payload_json` DEBE pasar por `redactSensitiveObject` antes de persistirse; es el lugar donde con más facilidad se cuela PII. Requiere retención corta o agregación, e índices por (`customer_id`, `occurred_at`).',
  },
];
