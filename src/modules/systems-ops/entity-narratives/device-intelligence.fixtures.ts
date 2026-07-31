/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Dispositivo, sesión, SIM, IP y cómputo on-device: la capa de fraude temprano (schema `telemetry`). */
export const DEVICE_INTELLIGENCE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'global_device_fingerprints',
    whyExists:
      'Un mismo teléfono puede aparecer en varios tenants. Esta tabla es la vista global de ese dispositivo: cuándo se vio por primera vez en toda la plataforma, cuántas veces se reusó y si está marcado como riesgoso. Es lo que convierte a Atlas en una red de defensa compartida en lugar de silos aislados.',
    whyNotDelete:
      'Es el único punto donde el conocimiento antifraude se acumula por encima del tenant. Sin ella, un dispositivo quemado en un cliente vuelve a entrar limpio en el siguiente, y la plataforma pierde su ventaja competitiva más concreta frente a un antifraude por cliente.',
    decisionContribution:
      '`global_reuse_count` y `global_risk_status` permiten elevar fricción o bloquear antes de tener historial de pago. Es una señal disponible en el segundo cero del onboarding, cuando todavía no existe ningún otro dato del cliente.',
    usageExample:
      'Un dispositivo con `global_reuse_count = 23` y `global_risk_status = high` intenta crear una cuenta en un tenant nuevo. La regla exige verificación reforzada de inmediato en lugar del flujo estándar, y el intento queda registrado aunque el cliente abandone.',
    systemsExplanation:
      'Tabla en `telemetry` SIN `_tenant_id`, deliberadamente: su alcance es global. Clave por (`device_fingerprint`, `fingerprint_version`); el versionado del fingerprint importa porque cambiar el algoritmo cambia el valor y no debe mezclarse con el anterior. `devices` la referencia por `global_device_fingerprint_id`. Los contadores se actualizan de forma atómica desde la ingesta de sesión.',
  },
  {
    tableName: 'devices',
    whyExists:
      'Es el dispositivo tal como lo ve un tenant: su huella, cuándo apareció, cuántas veces se reusó dentro de ese tenant y su estado de riesgo local. El negocio necesita esa vista propia porque las decisiones y los bloqueos son por tenant.',
    whyNotDelete:
      'Es el ancla de toda la inteligencia de dispositivo: snapshots, eventos de riesgo, vínculos con clientes, SIM y sesiones cuelgan de aquí. Borrarla desconecta las señales antifraude más tempranas y deja el fraude de multi-cuenta sin detección.',
    decisionContribution:
      '`tenant_reuse_count` detecta un mismo teléfono creando muchas cuentas dentro del cliente, y `risk_status` funciona como veredicto acumulado que puede bloquear, elevar fricción o mandar a revisión antes de gastar en consultas externas.',
    usageExample:
      'Un dispositivo acumula `tenant_reuse_count = 9` en dos semanas. La regla `DEVICE_MULTI_ACCOUNT` se dispara, el caso pasa a revisión manual y los nueve clientes asociados se listan por `customer_device_links` para evaluarlos como grupo.',
    systemsExplanation:
      'Tabla en `telemetry` con `_tenant_id`, unicidad por (`_tenant_id`, `device_fingerprint`) y FK a `global_device_fingerprints`. Tiene borrado lógico con `_deleted NOT NULL DEFAULT false`, porque un `_deleted` nulo haría invisible la fila para los filtros y rompería el índice único parcial. Los contadores se incrementan en la ingesta; `risk_status` lo mueven las reglas y queda auditado en `device_risk_events`.',
  },
  {
    tableName: 'customer_device_links',
    whyExists:
      'Modela la relación entre personas y dispositivos, que en la práctica es de muchos a muchos: una familia comparte un teléfono, una persona usa dos. El negocio necesita saber cuál es el dispositivo habitual de cada cliente y cuánto confía en él.',
    whyNotDelete:
      'Es lo que permite detectar tanto el fraude de multi-cuenta (un dispositivo, muchos clientes) como el robo de cuenta (un cliente accediendo desde un dispositivo nunca visto). Sin este vínculo explícito, ambas señales exigen recorrer sesiones y se pierden en el ruido.',
    decisionContribution:
      '`is_primary_device` y `trust_level` permiten decidir el nivel de fricción: operación desde el dispositivo habitual pasa sin ruido, desde uno nuevo exige verificación adicional. La aparición de muchos clientes sobre un mismo dispositivo dispara investigación.',
    usageExample:
      'Un cliente que siempre opera desde su dispositivo primario intenta una compra grande desde un teléfono visto por primera vez hace diez minutos. La regla eleva fricción y pide OTP; si el cliente confirma, el nuevo dispositivo sube de `trust_level` con el tiempo.',
    systemsExplanation:
      'Tabla puente en `telemetry` con `_tenant_id`, unicidad por (`customer_id`, `device_id`), estado del vínculo, marcas de primera y última sesión y borrado lógico. `first_seen_at`/`last_seen_at` se actualizan en cada sesión, así que es una tabla de escritura frecuente: conviene actualizarla de forma asíncrona o agrupada para no penalizar la ruta de login.',
  },
  {
    tableName: 'device_snapshots',
    whyExists:
      'Captura cómo era el dispositivo en un momento dado: marca, modelo, versión de sistema y de app, si estaba rooteado, si era emulador, si había VPN. Además estima el valor y la antigüedad del equipo, que en crédito al consumo es una señal socioeconómica real.',
    whyNotDelete:
      'Es la fotografía técnica que respalda una decisión. Sin ella no se puede probar que en el momento de aprobar el dispositivo no estaba rooteado, ni analizar fraude por modelo o versión de app, ni detectar granjas de emuladores.',
    decisionContribution:
      '`is_rooted`, `is_emulator` y `vpn_detected` pueden ser hard stops antifraude. `device_tier_snapshot`, `device_release_year`, `device_age_months` y `estimated_device_value_bs_snapshot` alimentan features de capacidad de pago y ayudan a calibrar límites iniciales sin historial crediticio.',
    usageExample:
      'Cincuenta solicitudes llegan desde dispositivos con `is_emulator = true` y el mismo `app_version`. La regla las bloquea en bloque y el equipo de fraude identifica una granja antes de que ninguna llegue a desembolso.',
    systemsExplanation:
      'Tabla append-only y de alto volumen en `telemetry`, ligada a `devices`, `customers` y `customer_sessions`, con `captured_at`. Los campos `*_snapshot` congelan valores derivados de catálogos que pueden cambiar (tier, valor estimado), para que decisiones pasadas no se alteren. Exige índices por (`device_id`, `captured_at`) y política de retención con agregación: el detalle antiguo no se conserva indefinidamente.',
  },
  {
    tableName: 'device_risk_events',
    whyExists:
      'Registra cada cambio en el estado de riesgo de un dispositivo y por qué ocurrió. El negocio necesita esa bitácora para no depender de un `risk_status` sin memoria.',
    whyNotDelete:
      'Es la justificación de un bloqueo de dispositivo. Sin ella, `devices.risk_status = blocked` es un veredicto sin expediente: no se sabe qué lo causó, quién lo aplicó ni si el motivo sigue vigente, y desbloquear se vuelve una decisión a ciegas.',
    decisionContribution:
      'Permite decidir sobre reincidencia y rehabilitación de dispositivos, y medir qué reglas generan más bloqueos y cuántos se revierten. Un dispositivo con eventos repetidos por el mismo motivo se trata distinto a uno con un único evento aislado.',
    usageExample:
      'Un dispositivo pasa de `clean` a `suspicious` con `reason_code = ROOT_DETECTED` y evidencia del snapshot. Tres semanas después, tras varios snapshots limpios con la app reinstalada, un analista lo devuelve a `clean` y el evento queda registrado con su justificación.',
    systemsExplanation:
      'Tabla append-only en `telemetry` con `previous_risk_status`, `new_risk_status`, `reason_code`, `supporting_evidence_json` y `happened_at`. Se escribe en la misma transacción que el cambio de `devices.risk_status`, o el estado y su historia divergen. `supporting_evidence_json` debe pasar por redacción antes de persistirse: no puede arrastrar PII cruda.',
  },
  {
    tableName: 'device_tokens',
    whyExists:
      'Guarda el token de notificaciones push de cada dispositivo. Sin él, el negocio no puede alcanzar al cliente en tiempo real para avisos de seguridad, recordatorios de pago o confirmaciones.',
    whyNotDelete:
      'Es el canal de contacto más inmediato y barato. Perderlo obliga a caer a SMS o correo, que cuestan más y llegan peor, y elimina la capacidad de avisar de un intento de acceso sospechoso mientras está ocurriendo.',
    decisionContribution:
      'Determina si un cliente es alcanzable por push, lo que condiciona la estrategia de comunicación y cobranza. Un token inactivo o eliminado es también señal de desinstalación de la app, que es un predictor de abandono y de riesgo de mora.',
    usageExample:
      'Se detecta un login desde un país distinto. El sistema busca los tokens activos del cliente y envía un push inmediato "¿fuiste tú?"; si el cliente responde que no, la sesión se revoca y se abre caso de fraude.',
    systemsExplanation:
      'Tabla en `telemetry` con `_tenant_id`, `platform`, `token_hash` para deduplicar y comparar, `token_encrypted` para el envío real y `token_last4` para diagnóstico. El token es un secreto: no se loguea ni se expone en el portal. `is_active` y `last_seen_at` permiten desactivar tokens que el proveedor push reporta como inválidos, evitando reintentos que degradan la reputación de envío.',
  },
  {
    tableName: 'sim_observations',
    whyExists:
      'La línea telefónica es, en el mercado boliviano, un ancla de identidad más estable que el correo. Esta tabla observa la SIM: operador, tipo, antigüedad de la línea y si hubo un cambio reciente de SIM.',
    whyNotDelete:
      'Sin ella se pierde la detección de SIM swap, que es el vector clásico para secuestrar cuentas protegidas por OTP. También se pierde la antigüedad de línea, una de las pocas señales de estabilidad disponibles en clientes sin historial crediticio.',
    decisionContribution:
      '`sim_swap_days_since` y `phone_line_tenure_months` deciden si se permite una operación sensible o se exige verificación adicional. Un cambio de SIM hace pocos días combinado con una solicitud de crédito es un patrón de fraude conocido y debe frenar el flujo.',
    usageExample:
      'Un cliente solicita cambiar su cuenta de cobro. La observación muestra `sim_swap_days_since = 2`. La operación se congela 72 horas y se exige verificación por un canal alternativo, evitando un takeover.',
    systemsExplanation:
      'Tabla append-only en `telemetry`, ligada a `devices`, `customers` y `customer_sessions`. El número se guarda como `phone_number_hash` más `phone_last_4`, nunca en claro. `source_type` distingue lo leído del dispositivo de lo confirmado por un proveedor de telecomunicaciones, y `confidence_score` pondera la señal. La captura requiere consentimiento vigente.',
  },
  {
    tableName: 'ip_reputation_observations',
    whyExists:
      'Registra desde qué red se conecta el cliente y qué reputación tiene esa red: VPN, proxy, Tor, país, ciudad, puntaje. Es la señal más rápida para distinguir un usuario normal de alguien que se está ocultando.',
    whyNotDelete:
      'Sin ella se pierde la detección de anonimización y de geografía inconsistente, y el análisis forense posterior a un incidente queda sin el dato de origen de la conexión. También desaparece la capacidad de medir el costo y la calidad del proveedor de reputación IP.',
    decisionContribution:
      '`is_vpn`, `is_proxy`, `is_tor`, `country_code` y `reputation_score` alimentan el `device_risk_score` y pueden elevar fricción o bloquear. La inconsistencia entre el país de la IP y el país declarado del cliente es una señal directa de suplantación.',
    usageExample:
      'Un onboarding declara domicilio en La Paz pero todas las sesiones llegan desde una IP de otro continente marcada como VPN. La regla baja el `consistency_score`, el caso no se aprueba automáticamente y pasa a revisión.',
    systemsExplanation:
      'Tabla append-only en `telemetry` ligada a sesión, cliente, dispositivo y a la consulta al proveedor (`provider_request_id`), lo que permite atribuir costo y latencia. La IP es dato personal en muchos marcos legales: su retención se rige por política y no debe aparecer en logs sin redacción. Es de alto volumen y se consulta por (`customer_id`, `captured_at`).',
  },
  {
    tableName: 'customer_sessions',
    whyExists:
      'Es la unidad de uso del producto: cuándo entró el cliente, desde qué dispositivo y canal, cómo se autenticó, desde qué IP y ubicación, y cómo terminó. Casi todo lo que el cliente hace ocurre dentro de una sesión.',
    whyNotDelete:
      'Es el hilo que conecta todo el comportamiento: observaciones, eventos de onboarding, capturas de GPS, acciones y consentimientos apuntan a una sesión. Sin ella, esos hechos quedan sueltos y es imposible reconstruir "qué pasó ese día" ante un fraude o un reclamo.',
    decisionContribution:
      'Alimenta features de comportamiento (frecuencia, horarios, duración, canal) y permite decidir sobre anomalías de sesión: sesiones simultáneas desde ubicaciones incompatibles, o una sesión que se autentica de forma más débil justo antes de una operación sensible.',
    usageExample:
      'Se investiga una compra desconocida. La sesión asociada muestra `auth_method = otp`, una IP de otra ciudad y un `device_id` distinto al habitual. Con eso se revoca la sesión, se bloquea el dispositivo y se abre caso de fraude con evidencia concreta.',
    systemsExplanation:
      'Tabla en `telemetry` con `_tenant_id`, `session_token_hash` (nunca el token), tiempos de inicio y fin, IP, user agent, coordenadas opcionales y `session_status`. Es de muy alto volumen y de escritura constante, por lo que conviene particionarla o purgarla por antigüedad. La captura de GPS dentro de la sesión depende de consentimiento y de permiso concedido en el dispositivo.',
  },
  {
    tableName: 'auth_events',
    whyExists:
      'Registra cada intento de autenticación del cliente: si tuvo éxito, por qué falló, desde qué dispositivo, sesión e IP. Es la bitácora de la puerta de entrada.',
    whyNotDelete:
      'Es la evidencia de un ataque de credenciales y la base de la investigación de un takeover. Sin ella no se puede demostrar que hubo cientos de intentos fallidos antes del acceso exitoso, ni medir la fricción real del login sobre la conversión.',
    decisionContribution:
      'Los patrones de fallo (`failure_reason_code`) y la ráfaga de intentos alimentan reglas de bloqueo y `customer_activity_summaries.failed_login_count_7d`. También sostienen decisiones de producto: si el 30% de los logins falla por OTP expirado, el problema es el diseño del flujo, no el usuario.',
    usageExample:
      'Un cliente acumula 40 intentos fallidos en cinco minutos desde IPs distintas y luego uno exitoso. La combinación dispara bloqueo preventivo, revocación de sesiones y notificación al titular antes de que se ejecute cualquier operación.',
    systemsExplanation:
      'Tabla append-only y de alto volumen en `telemetry`, ligada a cliente, sesión y dispositivo, con `occurred_at` e `ip_address`. Nunca guarda la credencial ni el código intentado. Debe escribirse fuera de la transacción crítica del login (o de forma asíncrona controlada) para no añadir latencia a la autenticación, pero sin perder eventos de fallo, que son los que importan.',
  },
  {
    tableName: 'on_device_computation_runs',
    whyExists:
      'Permite calcular señales en el teléfono del cliente sin traerse los datos crudos al servidor: se procesan contactos o mensajes localmente y solo suben métricas agregadas. Es lo que hace viable usar esas señales sin asumir el riesgo legal de almacenarlas.',
    whyNotDelete:
      'Es la prueba de que el procesamiento fue on-device y de que NO se guardaron datos crudos: las banderas `raw_contacts_stored` y `raw_sms_stored` son exactamente la evidencia que un regulador pide. Sin esta tabla, la organización no puede demostrar el compromiso de minimización que hizo al usuario.',
    decisionContribution:
      'Habilita features de riesgo derivadas de datos que de otro modo serían intocables, con `algorithm_code`/`algorithm_version` para explicarlas y `integrity_hash` para confiar en ellas. Su `computation_status` decide si las métricas asociadas pueden usarse o deben descartarse.',
    usageExample:
      'El dispositivo calcula localmente cuántos contactos guardados coinciden con la libreta declarada y sube solo el porcentaje. El servidor recibe la corrida con `raw_contacts_stored = false` e `integrity_hash`, y usa la métrica en el score sin haber visto un solo número de teléfono ajeno.',
    systemsExplanation:
      'Tabla append-only en `telemetry`, ligada a cliente, dispositivo, sesión, flujo de onboarding y al consentimiento que la autoriza (`consent_id`). Guarda `computed_at_device` y `received_at_server` por separado: la diferencia detecta relojes manipulados o envíos diferidos. `integrity_hash` debe validarse en el servidor antes de aceptar las métricas; una corrida sin consentimiento vigente debe rechazarse.',
  },
  {
    tableName: 'on_device_metric_values',
    whyExists:
      'Guarda las métricas agregadas que sí suben del dispositivo. Son el resultado utilizable del cómputo local: porcentajes, conteos, indicadores, sin ningún dato personal de terceros.',
    whyNotDelete:
      'Son señales de riesgo que no se pueden reconstruir después: dependen de un estado del dispositivo en un momento que ya pasó. Borrarlas obliga a volver a pedir permisos al usuario, con la fricción y el rechazo que eso implica.',
    decisionContribution:
      'Alimentan features de comportamiento y de red social del cliente, útiles justamente en el segmento sin historial crediticio. `confidence_score` permite ponderar la métrica, y su ausencia (permiso denegado) es a su vez una señal.',
    usageExample:
      'La métrica `CONTACT_OVERLAP_RATIO = 0.04` indica casi ningún solapamiento entre los contactos del dispositivo y los del entorno declarado. Combinada con un dispositivo nuevo, contribuye a un `fraud_score` alto y manda el caso a revisión.',
    systemsExplanation:
      'Tabla append-only en `telemetry`, hija de `on_device_computation_runs`, con valor tipado (`value_text`/`value_number`/`value_boolean`/`value_json`) y `metric_code` como clave semántica. Una métrica solo es válida si su corrida padre está en estado exitoso y su hash de integridad verificó; el consumidor de features debe comprobarlo en lugar de leer la métrica suelta.',
  },
];
