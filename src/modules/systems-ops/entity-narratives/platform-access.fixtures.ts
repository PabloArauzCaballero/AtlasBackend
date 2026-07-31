/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Multitenencia, usuarios internos, RBAC, credenciales y control de reintentos (schema `iam`). */
export const PLATFORM_ACCESS_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'tenants',
    whyExists:
      'Atlas no es un producto de un solo cliente: es una plataforma que la opera más de una entidad (financiera, retail, billetera) y en más de un país. `tenants` es la raíz que declara cuál es cada una de esas entidades operativas, su razón social, su país y si está activa. Sin esta tabla el negocio no puede vender el mismo backend a dos clientes distintos ni operar Bolivia y otro país con reglas legales diferentes.',
    whyNotDelete:
      'Es la raíz de aislamiento de datos: casi todas las tablas de negocio llevan `_tenant_id`. Eliminarla convierte cada consulta multi-tenant en una consulta sin frontera, es decir, una fuga de datos entre clientes que ninguna auditoría acepta. Además destruye la capacidad de responder "¿de quién es este cliente/este caso de fraude?" y rompe la trazabilidad contractual con cada entidad.',
    decisionContribution:
      'Toda decisión (aprobar, bloquear, notificar, cobrar) se toma dentro de un tenant y bajo su configuración: país, moneda, marco legal, umbrales de riesgo. El tenant define qué política aplica y contra qué contrato se responde, y permite medir rentabilidad, riesgo y volumen por cliente comercial para decisiones de negocio (renovar, ampliar, cortar).',
    usageExample:
      'Un analista de riesgo abre un caso y ve que pertenece al tenant `BOL-RETAIL-01`. Ese tenant tiene `country_code = BO`, así que el motor de riesgo aplica el ruleset boliviano, el buró consultado es el local y la retención de documentos se rige por la política de ese país; el mismo caso bajo otro tenant habría usado otras reglas.',
    systemsExplanation:
      'Tabla de catálogo pequeña y de baja escritura, en el schema `iam`, con `tenant_code` único y borrado lógico (`_deleted`). El `TenantGuard` cruza el header `x-tenant-id` contra el claim del token y rechaza el cruce; los repositorios filtran por `_tenant_id` de forma sistemática. Es referenciada por FK o por convención desde prácticamente todo el modelo, por lo que su borrado físico está prohibido: se desactiva con `status`.',
  },
  {
    tableName: 'platform_users',
    whyExists:
      'Hay decisiones que no son de un tenant sino de la plataforma: aprobar una versión de modelo de riesgo, publicar un catálogo de contexto compartido, versionar el esquema de datos. `platform_users` representa a las personas de Atlas que pueden ejecutar ese gobierno corporativo por encima de los tenants.',
    whyNotDelete:
      'Es el actor que firma los actos de gobierno más sensibles del sistema: `risk_model_versions.approved_by_platform_user_id`, `context_catalog_versions.approved_by_platform_user_id`, `schema_change_log.approved_by_platform_user_id`. Si se borra, todas esas aprobaciones quedan huérfanas y el sistema deja de poder responder "¿quién autorizó este modelo que rechaza créditos?".',
    decisionContribution:
      'Aporta accountability: separa lo que decide un operador de un tenant de lo que decide la plataforma. Permite exigir doble control (quien propone ≠ quien aprueba) en cambios de modelo, catálogo y esquema, que es exactamente el control que pide un regulador o un auditor externo sobre decisiones automatizadas.',
    usageExample:
      'Data science propone `risk_model_versions` v3. Un `platform_user` con rol de gobierno la aprueba; queda registrado su `_id` y `approved_at`. Seis meses después, ante un reclamo de un cliente rechazado, se demuestra qué versión estaba vigente ese día y quién la autorizó.',
    systemsExplanation:
      'Catálogo en `iam` con `user_code` y `email` únicos, `role_code` y borrado lógico. No comparte tabla con `internal_users` a propósito: el alcance de autorización es distinto (cross-tenant vs. intra-tenant) y mezclarlos volvería ambiguo el chequeo de permisos. Sus credenciales viven en `auth_credentials` con `actor_type = platform_user`.',
  },
  {
    tableName: 'internal_users',
    whyExists:
      'Cada tenant tiene un equipo que opera el día a día: analistas de KYC, compliance, fraude, soporte, riesgo. `internal_users` es el registro nominal de esas personas dentro del tenant, con su departamento, cargo y estado. Sin ella, "el sistema aprobó" y "María de compliance aprobó" serían indistinguibles.',
    whyNotDelete:
      'Es el sujeto de casi toda la auditoría operativa: `operational_audit_logs.actor_internal_user_id`, `evidence_reviews.reviewed_by`, `manual_review_cases.assigned_to_internal_user_id`, `fraud_cases.assigned_to_internal_user_id`. Borrarla anonimiza retroactivamente años de decisiones humanas y hace imposible investigar un fraude interno o defender una decisión ante un cliente.',
    decisionContribution:
      'Determina quién puede decidir qué (vía RBAC) y permite medir la calidad de las decisiones humanas: tasa de aprobación por analista, tiempo de resolución, reversiones. Esa medición alimenta decisiones de negocio como recalibrar reglas, reforzar entrenamiento o cambiar los umbrales que mandan casos a revisión manual.',
    usageExample:
      'Un cliente reclama que su solicitud fue rechazada. El caso muestra que el analista `INT-0042` (compliance) cerró la revisión manual con motivo "documento ilegible". Con eso el supervisor reabre el caso, pide nueva evidencia y mide cuántos rechazos de ese tipo produce ese analista frente a la media.',
    systemsExplanation:
      'Tabla en `iam`, alcanzada por `_tenant_id`, con `email` único por tenant, `status`, `must_change_password`, `mfa_enabled` y borrado lógico. La autenticación real vive en `auth_credentials` (`actor_type = internal_user`); los permisos efectivos se resuelven por `internal_user_roles` → `internal_roles` → `internal_role_permissions` → `internal_permissions`. `role_code` se conserva como campo legado/denormalizado y no debe usarse como fuente de verdad de autorización.',
  },
  {
    tableName: 'internal_roles',
    whyExists:
      'Los permisos no se asignan persona por persona sino por función de negocio: "analista KYC", "supervisor de fraude", "soporte nivel 1". `internal_roles` declara ese catálogo de funciones y lo hace explícito y revisable, en lugar de vivir escondido en el código.',
    whyNotDelete:
      'Si desaparece, la autorización se degrada a permisos sueltos por usuario, algo que en la práctica nadie mantiene y que termina en usuarios con más privilegios de los que necesitan. También se pierde la evidencia histórica de qué significaba un rol cuando se otorgó, que es lo que un auditor pide al revisar segregación de funciones.',
    decisionContribution:
      'Define la frontera de quién puede tomar cada decisión: quién aprueba un crédito, quién puede ver PII en claro, quién puede cerrar un caso de fraude. Es el mecanismo que hace cumplir la segregación de funciones (el que investiga no es el que aprueba) que sostiene la validez de las decisiones ante terceros.',
    usageExample:
      'Se crea el rol `FRAUD_SUPERVISOR` con permiso para cerrar casos y sin permiso para modificar reglas de riesgo. Al intentar editar un `risk_policy_rules`, el `RolesGuard` rechaza la petición y el intento queda en `system_action_logs`.',
    systemsExplanation:
      'Catálogo en `iam` con `role_code` único, `is_system_role` para roles que el producto no permite borrar y borrado lógico. Se consume en `roles.guard.ts` a través del decorador `@Roles`; `internal-rbac.roles.ts` y `internal-rbac.permissions.ts` mantienen la definición en código sincronizada con la fila. Los roles de sistema deben ser idempotentes en el seeder de producción.',
  },
  {
    tableName: 'internal_permissions',
    whyExists:
      'Es el vocabulario atómico de lo que se puede hacer en Atlas: módulo, recurso y acción (`customers:read`, `fraud_case:close`). El negocio necesita ese catálogo para poder decir con precisión qué autoriza cada rol, en vez de discutir sobre nombres de pantallas.',
    whyNotDelete:
      'Es la única lista completa y auditable de capacidades del sistema. Sin ella no se puede responder "¿qué podía hacer exactamente este usuario en marzo?", ni detectar permisos huérfanos o privilegios excesivos, ni construir la matriz de segregación de funciones que exige compliance.',
    decisionContribution:
      'Sus banderas `risk_level`, `requires_reason` y `requires_mfa` convierten al permiso en una decisión de control, no solo en un booleano: acciones de alto riesgo obligan a justificar por escrito o a re-autenticar. Eso reduce el fraude interno y produce evidencia utilizable en una investigación.',
    usageExample:
      'El permiso `customer_pii:reveal` tiene `risk_level = HIGH` y `requires_reason = true`. Cuando soporte revela el teléfono completo de un cliente, el sistema obliga a escribir el motivo y lo guarda en `operational_audit_logs`; el reporte mensual muestra quién reveló PII y por qué.',
    systemsExplanation:
      'Catálogo en `iam` con clave natural (`module_code`, `resource_code`, `action_code`) y `permission_code` único. `internal-rbac.permissions.ts` es la fuente en código; el seeder de producción la materializa de forma idempotente. Se une a roles vía `internal_role_permissions`; el guard resuelve permisos efectivos por usuario y los cachea por request.',
  },
  {
    tableName: 'internal_role_permissions',
    whyExists:
      'Es la tabla que responde, en términos de negocio, "¿qué puede hacer realmente este rol?". Sin ese vínculo explícito, roles y permisos serían dos listas bonitas sin relación operativa.',
    whyNotDelete:
      'Es la definición efectiva de la autorización. Borrarla equivale a dejar a todos los roles sin capacidades (o, peor, a que el código caiga a un fallback permisivo). También destruye la evidencia de cuándo y por quién se amplió un rol, que es la primera pregunta tras un incidente de privilegios.',
    decisionContribution:
      'Permite decidir con evidencia sobre el modelo de acceso: detectar roles sobre-privilegiados, aprobar o rechazar una solicitud de ampliación, y demostrar que el acceso a datos sensibles está restringido a las funciones que lo necesitan.',
    usageExample:
      'Auditoría pregunta quién puede exportar datos de clientes. Un join entre `internal_role_permissions` y `internal_permissions` muestra que solo `COMPLIANCE_LEAD` tiene `customers:export`, y `created_by_internal_user_id` indica quién concedió ese vínculo.',
    systemsExplanation:
      'Tabla puente en `iam` con unicidad (`role_id`, `permission_id`), FKs a ambos lados y `created_by_internal_user_id` para trazar el otorgamiento. Es append-only en la práctica: quitar un permiso se hace borrando la fila y registrando el acto en `operational_audit_logs`. La resuelve `internal-rbac.repository.ts` al construir el conjunto de permisos del actor.',
  },
  {
    tableName: 'internal_user_roles',
    whyExists:
      'Asigna funciones a personas concretas y por período: cuándo se le dio el rol a alguien, quién se lo dio, cuándo se le revocó y por qué. El negocio necesita esa historia porque las personas rotan de equipo y las responsabilidades cambian.',
    whyNotDelete:
      'Guarda la dimensión temporal del acceso. Sin `assigned_at` / `revoked_at` es imposible responder "¿este analista tenía permiso el día que aprobó ese caso?", que es justamente lo que se pregunta cuando una decisión se impugna o cuando se investiga un acceso indebido.',
    decisionContribution:
      'Permite decisiones de control interno: revocar accesos al cambiar de área, detectar acumulación de roles incompatibles (quien crea y quien aprueba), y sustentar las recertificaciones periódicas de acceso que pide auditoría.',
    usageExample:
      'Un analista pasa de soporte a fraude. Se revoca `SUPPORT_L1` con `revocation_reason = "cambio de área"` y se asigna `FRAUD_ANALYST`. Tres meses después, una consulta por fecha demuestra que ya no tenía acceso a soporte cuando ocurrió el incidente investigado.',
    systemsExplanation:
      'Tabla puente en `iam` con `_tenant_id`, FKs a `internal_users` e `internal_roles`, y campos de otorgamiento/revocación con actor. Un rol está vigente si `revoked_at IS NULL`; el guard filtra por eso en cada resolución de permisos. No se borran filas revocadas: la fila revocada ES la evidencia.',
  },
  {
    tableName: 'auth_credentials',
    whyExists:
      'Separa "quién eres" (el usuario) de "cómo pruebas que eres tú" (la credencial). El negocio necesita poder bloquear una cuenta por intentos fallidos, forzar cambio de contraseña o invalidar todas las sesiones sin tocar el registro de la persona.',
    whyNotDelete:
      'Es el punto único donde vive el hash de contraseña, el `token_version` que invalida masivamente los JWT emitidos y el estado de bloqueo. Sin ella no hay forma de cerrar sesiones tras un compromiso de credenciales, ni de demostrar que la cuenta estaba bloqueada durante un intento de intrusión.',
    decisionContribution:
      'Sus contadores (`failed_login_attempts`, `locked_until`, `last_login_at`, `last_login_ip`, `mfa_enabled`) alimentan decisiones de seguridad: bloquear, exigir MFA, forzar rotación de contraseña, o abrir una investigación por accesos desde IPs inusuales.',
    usageExample:
      'Tras cinco intentos fallidos, `locked_until` se fija a 15 minutos en el futuro y los siguientes logins se rechazan aunque la contraseña sea correcta. Al detectar una filtración, se incrementa `token_version` y todos los JWT previamente emitidos dejan de validar en el siguiente request.',
    systemsExplanation:
      'Tabla en `iam` con clave (`actor_type`, `actor_id`) para servir tanto a `internal_users` como a `platform_users`. `password_hash` es Argon2 y nunca sale del backend; `token_version` se compara en `jwt-auth.guard.ts` contra el claim del token y un desajuste devuelve 401. Los endpoints que la tocan llevan `@Throttle` estricto. Ningún log puede contener el hash ni la contraseña en claro.',
  },
  {
    tableName: 'auth_refresh_tokens',
    whyExists:
      'Permite que una sesión dure sin obligar a reingresar la contraseña, y al mismo tiempo permite cortarla. Para el negocio es el equilibrio entre fricción (que expulsa usuarios) y control (poder expulsar a un atacante).',
    whyNotDelete:
      'Es el único registro de sesiones activas revocables. Sin él, un token robado es válido hasta su expiración natural y no hay manera de cerrarlo; además se pierde la cadena `replaced_by_token_id`, que es lo que permite detectar reuso de token (señal clásica de robo de sesión).',
    decisionContribution:
      'Habilita decidir revocar una sesión, cerrar todas las sesiones de un usuario, o marcar un dispositivo como comprometido. `user_agent`, `ip_address` y `revoked_reason` dan el contexto para tomar esa decisión con fundamento y no a ciegas.',
    usageExample:
      'Un usuario reporta actividad extraña. Soporte lista sus refresh tokens activos, ve una sesión desde otra ciudad y la revoca con `revoked_reason = "reportado por el titular"`; el siguiente intento de refresh desde esa sesión falla.',
    systemsExplanation:
      'Tabla en `iam` que guarda `token_hash` (nunca el token), fechas de emisión/expiración/revocación y el enlace de rotación. La rotación emite un token nuevo y marca el anterior como reemplazado; si llega un refresh con un token ya reemplazado, se trata como reuso y se revoca la cadena completa. Es append-only y crece: requiere purga por `expires_at` según la política de retención.',
  },
  {
    tableName: 'auth_one_time_codes',
    whyExists:
      'Soporta los flujos donde el negocio necesita probar control de un canal: verificar un teléfono o correo, recuperar contraseña, confirmar una operación sensible con un código de un solo uso.',
    whyNotDelete:
      'Es lo que impide que un código se reutilice o se adivine por fuerza bruta: guarda el hash, la expiración, el consumo y el contador de intentos. Sin esta tabla, el mecanismo de OTP no tiene estado y deja de ser un control de seguridad.',
    decisionContribution:
      'Determina si un contacto está verificado y si una recuperación de cuenta procede. Los intentos fallidos y la tasa de códigos no consumidos son señal de abuso y alimentan decisiones antifraude (bloquear destino, elevar fricción, alertar).',
    usageExample:
      'Un usuario pide recuperar contraseña: se genera un código con `purpose = password_reset`, `expires_at` a 10 minutos y `attempts = 0`. Al tercer intento errado el código se invalida y el sistema exige reiniciar el flujo.',
    systemsExplanation:
      'Tabla en `iam` con `code_hash`/`challenge_hash` (nunca el código en claro), `purpose`, `expires_at`, `consumed_at` y `attempts`. La verificación es comparación de hash con incremento atómico de intentos; el consumo es de una sola vez (`consumed_at` no nulo invalida). Los endpoints asociados llevan throttling estricto y cooldown por destino para no convertirlos en un canal de spam.',
  },
  {
    tableName: 'idempotency_keys',
    whyExists:
      'Las redes fallan y los usuarios reintentan. Sin control de idempotencia, un reintento se convierte en un segundo cobro, una segunda solicitud de crédito o una segunda consulta pagada a un buró. Esta tabla existe para que "lo mismo enviado dos veces" produzca un solo efecto de negocio.',
    whyNotDelete:
      'Es la garantía de exactamente-una-vez a nivel de API. Eliminarla expone al negocio a duplicados con costo directo (consultas a proveedores que se pagan por uso) y a inconsistencias en el estado del cliente que después hay que reconciliar a mano.',
    decisionContribution:
      'Evita que decisiones automáticas se disparen dos veces sobre el mismo hecho (doble evaluación de riesgo, doble notificación). Además, al guardar `request_hash`, permite distinguir un reintento legítimo de una clave reusada con un cuerpo distinto, que es un intento de abuso.',
    usageExample:
      'La app envía una solicitud con `Idempotency-Key: 9f3a...`; se corta la red y reintenta. La segunda vez el backend encuentra la clave con `status = completed` y devuelve el `response_body_json` guardado sin volver a ejecutar la operación ni volver a pagarle al proveedor externo.',
    systemsExplanation:
      'Tabla con unicidad por (`tenant_scope`, `actor_type`, `actor_id`, `scope`, `idempotency_key`). El flujo es: insertar en estado en curso con `locked_until` (lock optimista con expiración para no bloquear para siempre si el proceso muere), ejecutar, y completar guardando `response_status` y `response_body_json`. Una clave repetida con `request_hash` distinto debe responder conflicto, no reusar la respuesta. Requiere purga periódica por antigüedad.',
  },
];
