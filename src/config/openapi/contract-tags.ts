/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite que un integrador entienda el contrato sin leer el código fuente.
 * @system declara y ordena las etiquetas con las que se agrupa la API en la referencia.
 */

/**
 * Etiquetas del contrato, con su descripción y en el orden en que deben aparecer.
 *
 * Nest emite `tags` por operación desde `@ApiTags`, pero **no** genera la lista global: de las 35
 * etiquetas en uso, sólo 3 estaban declaradas. Consecuencias reales, no formales:
 *
 *  - `redocly lint` fallaba con 96 errores `operation-tag-defined`.
 *  - La referencia interactiva agrupa por etiqueta, y una etiqueta sin descripción es un
 *    encabezado sin contexto: el integrador ve "kyc" y tiene que adivinar qué hay debajo.
 *
 * El ORDEN es deliberado y no alfabético: sigue el recorrido real del negocio (entrar → identificarse
 * → aportar datos → ser evaluado → obtener crédito), y sólo después la operación interna y la
 * infraestructura. Por eso `tags-alphabetical` está apagada en `redocly.yaml`.
 *
 * Una etiqueta usada en el código y ausente de esta lista hace fallar `redocly lint`, así que la
 * lista no puede quedarse atrás en silencio.
 */
export const CONTRACT_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  // --- Recorrido del cliente ------------------------------------------------------------------
  { name: 'auth', description: 'Autenticación: login, verificación por PIN, refresh, logout y recuperación de contraseña.' },
  { name: 'sessions', description: 'Sesiones activas del cliente, dispositivos asociados y cierre remoto.' },
  {
    name: 'customer-onboarding',
    description:
      'Alta y captura de datos del solicitante en seis secciones (contacto, personales, perfil financiero, domicilio, documentos, referencias) hasta el envío del paquete.',
  },
  { name: 'customers', description: 'Datos del cliente, su estado en la máquina de estados y su ficha consolidada.' },
  {
    name: 'customer-eligibility',
    description:
      'Elegibilidad crediticia. No responde sí/no: devuelve los BLOQUEADORES nombrados que impiden avanzar, y persiste la evidencia del cálculo.',
  },
  { name: 'consents', description: 'Documentos de consentimiento vigentes y aceptaciones del titular.' },
  { name: 'customer-privacy', description: 'Derechos del titular: consentimientos de tratamiento, retención y solicitudes de privacidad.' },
  { name: 'customer-telemetry', description: 'Señales de comportamiento y dispositivo capturadas durante el recorrido.' },
  { name: 'credit', description: 'Catálogo de productos de crédito, solicitudes y su ciclo hasta la decisión.' },

  // --- Evaluación -----------------------------------------------------------------------------
  { name: 'risk', description: 'Evaluación de riesgo versionada y explicable, con las features y el ruleset usados en cada decisión.' },
  {
    name: 'external-data',
    description: 'Orquestación de consultas a proveedores externos, con consentimiento, coste, caché e idempotencia.',
  },
  { name: 'kyc', description: 'Verificación de identidad contra fuentes autoritativas.' },
  { name: 'bureau', description: 'Consulta a buró crediticio. Proveedor costoso: bloqueado por política salvo aprobación explícita.' },
  { name: 'telco', description: 'Señales de operadora móvil: antigüedad de línea, actividad y cambio de SIM.' },
  { name: 'social', description: 'Señales sociales por OAuth voluntario. Sin scraping ni credenciales de terceros.' },
  { name: 'whatsapp', description: 'Contactabilidad y códigos de un solo uso por WhatsApp.' },
  { name: 'payments-external', description: 'Generación de QR de cobro bancario.' },
  { name: 'digital-trust', description: 'Reputación digital: riesgo de correo, IP y dispositivo, e identidad sintética.' },

  // --- Operación interna ----------------------------------------------------------------------
  { name: 'operations', description: 'Back office: revisión de identidad, cumplimiento, observaciones, fraude y decisión de crédito.' },
  { name: 'internal-auth', description: 'Autenticación del personal interno.' },
  { name: 'internal-users', description: 'Usuarios internos, roles y permisos (RBAC interno).' },
  { name: 'internal-admin-views', description: 'Vistas consolidadas para el portal administrativo.' },
  { name: 'internal-access-catalog', description: 'Catálogo de accesos: qué puede ver y hacer cada rol interno.' },
  { name: 'external-data-admin', description: 'Administración de proveedores externos: modos, políticas de coste, SLA y consumo.' },
  { name: 'notifications', description: 'Notificaciones multicanal, preferencias del destinatario y evidencia de entrega.' },
  {
    name: 'catalog-management',
    description: 'Catálogos versionados, definiciones semánticas y mapeos de riesgo que consume el motor de decisión.',
  },
  { name: 'internal-portal', description: 'Glosario de negocio, gobierno y trazabilidad para operadores internos.' },
  {
    name: 'workflow-catalog',
    description: 'El recorrido estándar como dato versionado, y su verificación contra las rutas realmente montadas.',
  },

  // --- Plataforma -----------------------------------------------------------------------------
  { name: 'audit', description: 'Registro de acciones de actores sobre recursos, con payload redactado.' },
  { name: 'events', description: 'Eventos de dominio y outbox transaccional.' },
  { name: 'runtime-jobs', description: 'Trabajos de fondo: outbox, eventos, sesiones, retención, notificaciones e idempotencia.' },
  { name: 'data-quality', description: 'Indicadores de calidad del dato y sus reglas.' },
  {
    name: 'schema-management',
    description: 'Gobierno del catálogo de esquema. El DDL físico sigue saliendo por migraciones revisadas en PR.',
  },
  { name: 'systems-ops', description: 'Salud, catálogo y pruebas controladas del propio backend.' },
  { name: 'health', description: 'Sondas de liveness y readiness. Públicas, sin autenticación.' },
];
