/**
 * @file Operación de la plataforma: reglas operativas, corridas de QA y pruebas de carga.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { PASOS_DE_PRUEBA, SUITES_DE_PRUEBA } from './suites-qa.seed-data.js';
import { refA, TENANT_DEMO, type DominioSembrado, type FilaSembrada } from './tipos.js';

/** Bloque: 991001–991099 reglas operativas · 991100–991199 corridas · 991200–991599 pasos de corrida. */

interface ReglaOperativa {
  readonly id: number;
  readonly code: string;
  readonly ambito: string;
  readonly tabla: string | null;
  readonly campo: string | null;
  readonly dominio: string;
  readonly tipo: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly porQue: string;
  readonly comoSeAplica: string;
  readonly capa: string;
  readonly severidad: string;
  readonly accion: string;
  readonly evidencia: string;
  readonly analisis: string;
}

const REGLAS: ReglaOperativa[] = [
  {
    id: 991001,
    code: 'OPR_PII_NUNCA_EN_CLARO',
    ambito: 'FIELD',
    tabla: 'customer.customers',
    campo: 'primary_phone_encrypted',
    dominio: 'CUSTOMER',
    tipo: 'PRIVACY',
    nombre: 'El teléfono nunca se guarda en claro',
    descripcion: 'La columna guarda texto cifrado; la búsqueda usa el hash y la pantalla muestra los últimos cuatro dígitos.',
    porQue: 'Un volcado de la base no puede convertirse en una lista de teléfonos. Es la diferencia entre un incidente y una filtración.',
    comoSeAplica: 'Cifrado de sobre en la capa de repositorio, con la llave fuera de la base.',
    capa: 'REPOSITORY',
    severidad: 'CRITICAL',
    accion: 'Rechazar la escritura y registrar el intento.',
    evidencia: 'Cada lectura queda en la bitácora de auditoría con el actor.',
    analisis: 'Permite medir quién accede a datos de contacto y con qué caso abierto.',
  },
  {
    id: 991002,
    code: 'OPR_TENANT_OBLIGATORIO',
    ambito: 'TABLE',
    tabla: null,
    campo: null,
    dominio: 'PLATFORM',
    tipo: 'SECURITY',
    nombre: 'Toda consulta de negocio lleva inquilino',
    descripcion: 'Ninguna lectura de tablas con `_tenant_id` puede omitir el filtro por inquilino.',
    porQue: 'Sin esto un error de consulta enseña datos de otro mercado. El aislamiento no puede depender de acordarse.',
    comoSeAplica: 'Políticas de seguridad a nivel de fila más el gate `check:tenant-header` en integración continua.',
    capa: 'DATABASE',
    severidad: 'CRITICAL',
    accion: 'La consulta devuelve cero filas y el gate rompe la construcción.',
    evidencia: 'La política de fila deja traza en el propio motor.',
    analisis: 'Detecta módulos que todavía consultan sin contexto.',
  },
  {
    id: 991003,
    code: 'OPR_DECISION_CON_ARTEFACTO',
    ambito: 'TABLE',
    tabla: 'credit.credit_applications',
    campo: 'decision_artifact_version_id',
    dominio: 'CREDIT',
    tipo: 'AUDIT',
    nombre: 'Toda decisión dice qué versión la tomó',
    descripcion: 'Una solicitud decidida guarda el código y la versión exacta del artefacto que la resolvió.',
    porQue:
      'Sin la versión no se puede reconstruir una decisión pasada, y una decisión de crédito que no se puede explicar no se puede defender ante un reclamo.',
    comoSeAplica: 'El servicio de decisión escribe la versión junto al desenlace, en la misma transacción.',
    capa: 'SERVICE',
    severidad: 'HIGH',
    accion: 'No se persiste la decisión sin versión.',
    evidencia: 'La ficha del cliente muestra el artefacto de cada decisión.',
    analisis: 'Permite comparar el comportamiento entre versiones.',
  },
  {
    id: 991004,
    code: 'OPR_MORA_SIN_HOSTIGAMIENTO',
    ambito: 'DOMAIN',
    tabla: null,
    campo: null,
    dominio: 'CREDIT',
    tipo: 'LIFECYCLE',
    nombre: 'La gestión de mora tiene límites',
    descripcion:
      'No se contacta a terceros ajenos a las referencias declaradas, no se visita sin aviso y no se usa lenguaje intimidatorio.',
    porQue: 'La cobranza agresiva recupera menos y cuesta la licencia social. Está medido: los reclamos suben y la recuperación no.',
    comoSeAplica: 'Plantillas revisadas por Cumplimiento y auditoría de las llamadas.',
    capa: 'PROCESS',
    severidad: 'HIGH',
    accion: 'Falta grave del agente, con revisión del caso.',
    evidencia: 'Grabaciones y plantillas versionadas.',
    analisis: 'Cruza reclamos con agente y tramo de mora.',
  },
  {
    id: 991005,
    code: 'OPR_OBSERVACION_PROHIBIDA',
    ambito: 'CATALOG',
    tabla: 'catalog.observation_definitions',
    campo: 'allowed_for_credit_decision',
    dominio: 'RISK',
    tipo: 'RISK',
    nombre: 'Hay datos que existen y no deciden',
    descripcion: 'Género, edad y zona están en la base pero no pueden entrar en una decisión de crédito.',
    porQue:
      'Son categorías protegidas o sus sustitutos. Guardarlas es legítimo; decidir con ellas es discriminación, aunque el modelo mejore.',
    comoSeAplica: 'El catálogo marca la observación como prohibida y el artefacto no la recibe.',
    capa: 'SERVICE',
    severidad: 'CRITICAL',
    accion: 'La ejecución falla antes de decidir.',
    evidencia: 'El catálogo guarda el motivo de la prohibición.',
    analisis: 'Base de la auditoría de equidad.',
  },
  {
    id: 991006,
    code: 'OPR_QR_REVISADO_POR_PERSONA',
    ambito: 'ENDPOINT',
    tabla: 'partner.partner_qr_codes',
    campo: 'status',
    dominio: 'PARTNER',
    tipo: 'FRAUD',
    nombre: 'El QR de cobro lo aprueba una persona',
    descripcion: 'Ningún QR pasa a activo sin que alguien con permiso lo revise.',
    porQue: 'Ahí termina el dinero de las ventas del comercio. Un QR con la cuenta de otro es el fraude más barato de cometer.',
    comoSeAplica: 'Permiso `partner.qr.review` y registro del revisor.',
    capa: 'CONTROLLER',
    severidad: 'CRITICAL',
    accion: 'El QR queda en revisión y el comercio no puede cobrar.',
    evidencia: 'Revisor, fecha y nota quedan en la propia fila.',
    analisis: 'Mide el tiempo de revisión y los rechazos por causa.',
  },
  {
    id: 991007,
    code: 'OPR_RETENCION_POR_CLASE',
    ambito: 'DOMAIN',
    tabla: null,
    campo: null,
    dominio: 'PRIVACY',
    tipo: 'RETENTION',
    nombre: 'Cada dato tiene un plazo de vida',
    descripcion: 'La clasificación del dato define cuánto se conserva y qué pasa al vencer.',
    porQue: 'Guardar para siempre «por si acaso» es el incumplimiento más común y el más caro de revertir.',
    comoSeAplica: 'Políticas de retención enlazadas a la clasificación, aplicadas por un trabajo nocturno.',
    capa: 'JOB',
    severidad: 'MEDIUM',
    accion: 'Anonimizar o borrar según la política.',
    evidencia: 'El trabajo deja constancia de qué borró y bajo qué política.',
    analisis: 'Permite demostrar cumplimiento sin revisar fila por fila.',
  },
  {
    id: 991008,
    code: 'OPR_IDEMPOTENCIA_EN_DINERO',
    ambito: 'ENDPOINT',
    tabla: 'credit.loan_payments',
    campo: 'idempotency_key_hash',
    dominio: 'CREDIT',
    tipo: 'INTEGRATION',
    nombre: 'Un pago no se registra dos veces',
    descripcion: 'Todo endpoint que mueve dinero exige clave de idempotencia y la guarda.',
    porQue: 'Un reintento de red no puede convertirse en un cobro duplicado.',
    comoSeAplica: 'Cabecera obligatoria y unicidad en la base.',
    capa: 'CONTROLLER',
    severidad: 'CRITICAL',
    accion: 'El segundo intento devuelve el resultado del primero.',
    evidencia: 'La clave queda junto al movimiento.',
    analisis: 'Mide cuántos reintentos llegan de verdad.',
  },
];

const reglas = REGLAS.map((r) => ({
  _id: r.id,
  rule_code: r.code,
  scope_type: r.ambito,
  schema_name: r.tabla ? r.tabla.split('.')[0] : 'public',
  table_name: r.tabla ? r.tabla.split('.')[1] : null,
  column_name: r.campo,
  domain_code: r.dominio,
  rule_type: r.tipo,
  rule_name: r.nombre,
  description: r.descripcion,
  business_reason: r.porQue,
  technical_enforcement: r.comoSeAplica,
  enforcement_layer: r.capa,
  severity: r.severidad,
  expected_action: r.accion,
  audit_evidence: r.evidencia,
  analysis_value: r.analisis,
  is_active: true,
  source_document: 'curaduria_atlas',
  confidence_level: 'HIGH',
  review_status: 'APPROVED',
  _created_at: '2026-07-01T00:00:00Z',
  _updated_at: '2026-07-01T00:00:00Z',
}));

const CORRIDAS = [
  {
    id: 991101,
    suite: 'SMOKE_CORE_READINESS',
    estado: 'PASSED',
    inicio: '2026-09-17T06:00:00Z',
    ms: 2140,
    pasados: 3,
    fallidos: 0,
    nota: 'Corrida nocturna. Todo verde.',
  },
  {
    id: 991102,
    suite: 'PORTAL_ADMIN_SYSTEMS_READINESS',
    estado: 'PASSED',
    inicio: '2026-09-17T06:01:00Z',
    ms: 5820,
    pasados: 7,
    fallidos: 0,
    nota: 'Corrida nocturna.',
  },
  {
    id: 991103,
    suite: 'OPERATIONS_WORK_QUEUE_READINESS',
    estado: 'FAILED',
    inicio: '2026-09-17T06:02:00Z',
    ms: 4310,
    pasados: 4,
    fallidos: 1,
    nota: 'El paso «Calidad de datos» devolvió 200 con lista vacía; la aserción exige al menos una incidencia.',
  },
  {
    id: 991104,
    suite: 'CATALOG_RISK_GOVERNANCE_READINESS',
    estado: 'PASSED',
    inicio: '2026-09-17T06:03:00Z',
    ms: 3190,
    pasados: 4,
    fallidos: 0,
    nota: 'Corrida nocturna.',
  },
  {
    id: 991105,
    suite: 'EXTERNAL_PROVIDERS_READINESS',
    estado: 'PASSED',
    inicio: '2026-09-16T06:04:00Z',
    ms: 6750,
    pasados: 4,
    fallidos: 0,
    nota: 'Corrida del día anterior, contra los proveedores simulados.',
  },
  {
    id: 991106,
    suite: 'NOTIFICATIONS_READINESS',
    estado: 'CANCELLED',
    inicio: '2026-09-16T06:05:00Z',
    ms: 900,
    pasados: 1,
    fallidos: 0,
    nota: 'Cancelada a mano: coincidía con el despliegue de la tarde.',
  },
];

const corridas = CORRIDAS.map((c) => ({
  _id: c.id,
  // La lista del portal filtra por inquilino: una corrida sin `_tenant_id` existe en la tabla y no
  // aparece en ninguna pantalla, que es la peor forma de estar sembrado.
  _tenant_id: TENANT_DEMO,
  suite_id: refA('platform_ops.system_test_suites', { code: c.suite }),
  environment: 'LOCAL',
  triggered_by: 'schedule:nightly',
  status: c.estado,
  started_at: c.inicio,
  finished_at: c.inicio,
  duration_ms: c.ms,
  summary: { pasos: c.pasados + c.fallidos, pasados: c.pasados, fallidos: c.fallidos, nota: c.nota },
  _created_at: c.inicio,
  _updated_at: c.inicio,
}));

const pasosDeCorrida: FilaSembrada[] = [];
let idPaso = 991200;
for (const corrida of CORRIDAS) {
  const pasos = PASOS_DE_PRUEBA.filter((p) => p.suite_code === corrida.suite);
  pasos.slice(0, corrida.pasados + corrida.fallidos).forEach((paso, indice) => {
    const falla = corrida.estado === 'FAILED' && indice === corrida.pasados;
    pasosDeCorrida.push({
      _id: idPaso++,
      test_run_id: corrida.id,
      step_id: refA('platform_ops.system_test_steps', {
        suite_id: refA('platform_ops.system_test_suites', { code: corrida.suite }),
        step_order: paso.step_order,
      }),
      status: falla ? 'FAILED' : 'PASSED',
      request_payload_sanitized: {},
      response_body_sanitized: falla ? { items: [] } : { ok: true },
      status_code: 200,
      duration_ms: 120 + indice * 37,
      error_message: falla ? 'Se esperaba al menos un elemento y la respuesta trajo la lista vacía.' : null,
      _created_at: corrida.inicio,
    });
  });
}

/**
 * Las corridas de carga NO viven en una tabla propia: son filas de `system_job_runs` con el código
 * `systems_stress_run`. Sembrarlas donde el portal las busca es la diferencia entre una pantalla con
 * historial y una que dice «sin corridas» teniendo diez perfiles configurados al lado.
 */
const CORRIDAS_CARGA = [
  {
    id: 991601,
    perfil: 'STRESS_HEALTH',
    estado: 'completed',
    inicio: '2026-09-16T22:00:00Z',
    fin: '2026-09-16T22:01:00Z',
    resultado: { rps: 200, p95Ms: 38, errorRate: 0, veredicto: 'dentro de objetivo' },
  },
  {
    id: 991602,
    perfil: 'STRESS_INTERNAL_AUTH_LOGIN',
    estado: 'completed',
    inicio: '2026-09-16T22:05:00Z',
    fin: '2026-09-16T22:07:00Z',
    resultado: { rps: 40, p95Ms: 410, errorRate: 0.004, veredicto: 'dentro de objetivo; el límite de 10 intentos por minuto se respeta' },
  },
  {
    id: 991603,
    perfil: 'STRESS_OPERATIONS_WORK_QUEUE',
    estado: 'failed',
    inicio: '2026-09-16T22:10:00Z',
    fin: '2026-09-16T22:12:00Z',
    resultado: { rps: 60, p95Ms: 1480, errorRate: 0.012, veredicto: 'p95 por encima del tope de 1000 ms' },
    error: 'p95 de 1480 ms sobre un tope de 1000 ms: la consulta de la bandeja no usa el índice por estado.',
  },
  { id: 991604, perfil: 'STRESS_SYSTEMS_DATA_ENTITIES', estado: 'running', inicio: '2026-09-17T09:30:00Z', fin: null, resultado: null },
];

const corridasDeCarga = CORRIDAS_CARGA.map((c) => ({
  _id: c.id,
  _tenant_id: TENANT_DEMO,
  job_code: 'systems_stress_run',
  status: c.estado,
  started_at: c.inicio,
  completed_at: c.fin,
  input_json: { profileCode: c.perfil, environment: 'LOCAL' },
  result_json: c.resultado,
  error_message: (c as { error?: string }).error ?? null,
  triggered_by_type: 'user',
  triggered_by_id: 'internal:930007',
  _created_at: c.inicio,
}));

export const OPERACIONES: DominioSembrado = {
  nombre: 'operaciones',
  descripcion: 'Ocho reglas operativas explicadas, las seis suites de prueba con sus pasos y seis corridas con su desenlace real.',
  bloques: [
    { tabla: 'platform_ops.system_operational_rule_catalog', filas: reglas, conflicto: ['rule_code'] },
    { tabla: 'platform_ops.system_test_suites', filas: SUITES_DE_PRUEBA, conflicto: ['code'] },
    {
      tabla: 'platform_ops.system_test_steps',
      filas: PASOS_DE_PRUEBA.map(({ suite_code, ...resto }) => ({
        ...resto,
        suite_id: refA('platform_ops.system_test_suites', { code: suite_code }),
      })),
      conflicto: ['suite_id', 'step_order'],
    },
    { tabla: 'platform_ops.system_test_runs', filas: corridas },
    { tabla: 'platform_ops.system_test_step_runs', filas: pasosDeCorrida },
    { tabla: 'platform_ops.system_job_runs', filas: corridasDeCarga },
  ],
};
