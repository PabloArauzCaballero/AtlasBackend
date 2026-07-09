import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { QueryInterface, QueryTypes } from 'sequelize';
import {
  TABLE_BUSINESS_METADATA,
  DOMAIN_BUSINESS_METADATA,
  LOGICAL_RELATIONSHIP_METADATA,
} from '../../modules/systems-ops/systems-business-metadata.fixtures.js';
import { buildEndpointCode, moduleFromPath, routeNameFromMethodAndPath } from '../../modules/systems-ops/endpoint-code.util.js';

type SeedContext = { context: QueryInterface };
type ColumnRow = {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  referenced_schema: string | null;
  referenced_table: string | null;
  referenced_column: string | null;
};

type EndpointScan = {
  method: string;
  fullPath: string;
  controllerName: string | null;
  handlerName: string | null;
  sourceFile: string;
  bodySchema?: ContractRef;
  querySchema?: ContractRef;
  paramSchema?: ContractRef;
};

type ContractRef = {
  schemaReference: string;
  dtoReference: string | null;
  schemaJson: Record<string, unknown>;
  required: string[];
  optional: string[];
  sample: Record<string, unknown>;
};

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const API_PREFIX = `/${(process.env.API_PREFIX ?? 'api/v1').replace(/^\/+|\/+$/g, '')}`;
const TABLE_METADATA = new Map(TABLE_BUSINESS_METADATA.map((item) => [item.tableName, item]));

const TABLE_DOMAIN_OVERRIDES: Record<string, string> = {
  customers: 'IDENTIDAD_KYC',
  customer_status_events: 'IDENTIDAD_KYC',
  customer_profile_versions: 'IDENTIDAD_KYC',
  customer_contact_methods: 'IDENTIDAD_KYC',
  contact_verification_attempts: 'IDENTIDAD_KYC',
  customer_addresses: 'IDENTIDAD_KYC',
  customer_address_versions: 'IDENTIDAD_KYC',
  customer_reference_contacts: 'IDENTIDAD_KYC',
  evidence_documents: 'EVIDENCIAS',
  evidence_extractions: 'EVIDENCIAS',
  evidence_reviews: 'EVIDENCIAS',
  global_device_fingerprints: 'DISPOSITIVO',
  devices: 'DISPOSITIVO',
  customer_device_links: 'DISPOSITIVO',
  device_snapshots: 'DISPOSITIVO',
  device_risk_events: 'DISPOSITIVO',
  sim_observations: 'DISPOSITIVO',
  customer_sessions: 'DISPOSITIVO',
  auth_events: 'DISPOSITIVO',
  ip_reputation_observations: 'DISPOSITIVO',
  customer_action_logs: 'AUDITORIA',
  customer_activity_summaries: 'ONBOARDING',
  onboarding_flows: 'ONBOARDING',
  onboarding_step_events: 'ONBOARDING',
  form_field_interaction_events: 'ONBOARDING',
  permission_events: 'ONBOARDING',
  onboarding_behavior_summaries: 'ONBOARDING',
  context_sources: 'CONTEXTO_RIESGO',
  context_catalogs: 'CONTEXTO_RIESGO',
  context_catalog_versions: 'CONTEXTO_RIESGO',
  context_items: 'CONTEXTO_RIESGO',
  context_item_aliases: 'CONTEXTO_RIESGO',
  context_risk_mappings: 'CONTEXTO_RIESGO',
  context_staging_items: 'CONTEXTO_RIESGO',
  context_approval_events: 'CONTEXTO_RIESGO',
  context_ingestion_jobs: 'CONTEXTO_RIESGO',
  risk_signal_seeds: 'RIESGO_CREDITO',
};

const DOMAIN_OWNER_FALLBACK: Record<string, string> = Object.fromEntries(
  DOMAIN_BUSINESS_METADATA.map((domain) => [domain.domainCode, domain.ownerTeam]),
);

function normalizePath(part: string): string {
  return part.trim().replace(/^\/+|\/+$/g, '');
}

function joinPaths(...parts: string[]): string {
  const value = parts.map(normalizePath).filter(Boolean).join('/');
  return `/${value}`.replace(/\/+/g, '/');
}

function decoratorPath(raw: string | undefined): string {
  if (!raw) return '';
  const match = raw.match(/['"`]([^'"`]*)['"`]/);
  return match?.[1] ?? '';
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((entry) => join(directory, entry))
    .flatMap((entry) => (statSync(entry).isDirectory() ? walk(entry) : [entry]));
}

function classifyDomain(tableName: string): string {
  const override = TABLE_DOMAIN_OVERRIDES[tableName];
  if (override) return override;
  if (tableName.startsWith('system_')) return 'SISTEMAS_QA';
  if (/privacy|consent|retention|classification|sensitive|subject_request/.test(tableName)) return 'PRIVACIDAD';
  if (/identity|kyc|document|profile|contact|address|customer/.test(tableName)) return 'IDENTIDAD_KYC';
  if (/evidence|extraction|review/.test(tableName)) return 'EVIDENCIAS';
  if (/device|fingerprint|session|auth|sim|ip_reputation|vpn|emulator/.test(tableName)) return 'DISPOSITIVO';
  if (/onboarding|permission|form_field|behavior/.test(tableName)) return 'ONBOARDING';
  if (/feature|risk_assessment|risk_model|risk_ruleset|policy_rule|observation|attribute/.test(tableName)) return 'RIESGO_CREDITO';
  if (/fraud|watchlist|manual_review/.test(tableName)) return 'FRAUDE';
  if (/provider|external|health/.test(tableName)) return 'PROVEEDORES';
  if (/notification|outbox|message|template|token/.test(tableName)) return 'COMUNICACIONES';
  if (/quality|constraint/.test(tableName)) return 'CALIDAD_DATOS';
  if (/audit|log|event/.test(tableName)) return 'AUDITORIA';
  return TABLE_METADATA.get(tableName)?.domainCode ?? 'PLATAFORMA';
}

function moduleFromTable(tableName: string): string {
  const domain = classifyDomain(tableName);
  if (domain === 'SISTEMAS_QA') return 'systems';
  if (domain === 'IDENTIDAD_KYC') return 'customers';
  if (domain === 'PRIVACIDAD') return 'privacy';
  if (domain === 'DISPOSITIVO') return 'device-intelligence';
  if (domain === 'ONBOARDING') return 'onboarding';
  if (domain === 'RIESGO_CREDITO' || domain === 'CAPACIDAD_PAGO') return 'risk';
  if (domain === 'FRAUDE') return 'fraud';
  if (domain === 'PROVEEDORES') return 'external-data';
  if (domain === 'COMUNICACIONES') return 'notifications';
  if (domain === 'CALIDAD_DATOS') return 'data-quality';
  if (domain === 'AUDITORIA') return 'audit';
  return 'platform';
}

function natureFromDomain(domainCode: string): string {
  return DOMAIN_BUSINESS_METADATA.find((domain) => domain.domainCode === domainCode)?.dataNature ?? 'OPERACIONAL';
}

function humanize(value: string): string {
  return value
    .replace(/^_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function containsPii(tableName: string, columnName: string): boolean {
  return /customer|identity|contact|phone|email|address|gps|ip_address|user_agent|document|selfie|evidence|session|token|password|birth|name/.test(
    `${tableName}_${columnName}`,
  );
}

function containsFraudSignal(tableName: string, columnName: string): boolean {
  return /fraud|watchlist|device|sim|ip_reputation|vpn|rooted|emulator|fingerprint|liveness|forensics|risk_event|velocity/.test(
    `${tableName}_${columnName}`,
  );
}

function containsCapacitySignal(tableName: string, columnName: string): boolean {
  return /income|employment|salary|balance|payment|credit|limit|debt|capacity|affordability|expense|cashflow|feature_value/.test(
    `${tableName}_${columnName}`,
  );
}

function containsFinancial(tableName: string, columnName: string): boolean {
  return /amount|payment|purchase|installment|credit|limit|settlement|merchant|mdr|loan|debt|balance|cost|price|value/.test(
    `${tableName}_${columnName}`,
  );
}

function isMlCandidate(tableName: string, columnName: string): boolean {
  if (/(_id|_created_at|_updated_at|_deleted|hash|encrypted|token|password|s3_key|url)$/.test(columnName)) return false;
  return /score|count|days|months|status|reason|type|source|channel|gps|lat|lng|risk|fraud|confidence|duration|amount|value|tier|version|carrier|domain|feature|observation/.test(
    `${tableName}_${columnName}`,
  );
}

function mlGroup(tableName: string, columnName: string): string | null {
  if (!isMlCandidate(tableName, columnName)) return null;
  if (containsFraudSignal(tableName, columnName)) return 'fraud_device_behavior';
  if (containsCapacitySignal(tableName, columnName)) return 'capacity_and_affordability';
  if (/risk|score|feature|observation|attribute/.test(`${tableName}_${columnName}`)) return 'credit_risk_scoring';
  if (/onboarding|form|permission|duration|step/.test(`${tableName}_${columnName}`)) return 'onboarding_behavior';
  if (/status|reason|event/.test(`${tableName}_${columnName}`)) return 'operational_lifecycle';
  return 'business_context';
}

function sourceKind(columnName: string): string {
  if (columnName === '_id') return 'BACKEND_GENERATED';
  if (columnName === '_created_at' || columnName === '_updated_at' || columnName.endsWith('_at') || columnName.endsWith('_until'))
    return 'SYSTEM_CLOCK';
  if (columnName.startsWith('_tenant_id') || columnName.endsWith('_id') || columnName.endsWith('_by')) return 'BACKEND_GENERATED';
  if (columnName.includes('hash') || columnName.includes('encrypted') || columnName.includes('normalized') || columnName.includes('last_4'))
    return 'COMPUTED';
  if (/provider|response|external|ocr|bureau|reputation/.test(columnName)) return 'EXTERNAL_PROVIDER';
  if (/status|score|count|summary|snapshot|risk|confidence|reason|distance|duration|days_since|age_months|tier|result/.test(columnName))
    return 'COMPUTED';
  return 'PAYLOAD';
}

type EntityBusinessContext = {
  process: string;
  whyStore: string;
  auditUsage: string;
  analysisUsage: string;
  decisionUsage: string;
  dataGrain: string;
  operationalRules: Array<Record<string, unknown>>;
  qualityRules: Array<Record<string, unknown>>;
  relationshipsSummary: string;
  relationshipRationale: string;
  whoUses: string[];
};

function entityContext(tableName: string): EntityBusinessContext {
  const domain = classifyDomain(tableName);
  const entity = humanize(tableName).toLowerCase();
  const logical = LOGICAL_RELATIONSHIP_METADATA.filter((rel) => rel.sourceTable === tableName || rel.targetTable === tableName);
  const relationshipsSummary = logical.length
    ? logical.map((rel) => `${rel.sourceTable} -> ${rel.targetTable}: ${rel.relationshipType}`).join('; ')
    : TABLE_METADATA.get(tableName)?.relationships && !TABLE_METADATA.get(tableName)?.relationships?.startsWith('No hay')
      ? String(TABLE_METADATA.get(tableName)?.relationships)
      : 'Relaciones físicas detectadas por FK más relaciones lógicas gobernadas por flujo, endpoint y linaje.';
  const base: EntityBusinessContext = {
    process: `Soporta el proceso ${domain} de Atlas mediante la entidad ${entity}.`,
    whyStore: `Se conserva porque ${entity} no es un dato decorativo: permite continuidad operativa, auditoría, análisis longitudinal y explicación de decisiones futuras.`,
    auditUsage: `Auditoría usa ${tableName} para reconstruir actor, momento, fuente, estado y relación con decisiones o eventos posteriores.`,
    analysisUsage: `Analítica usa ${tableName} para cohortes, control de calidad, indicadores operativos y señales de comportamiento por ventana temporal.`,
    decisionUsage: `Decisiones usan ${tableName} como soporte directo o contextual según dominio: aprobación, revisión, bloqueo, soporte, comunicación o gobierno técnico.`,
    dataGrain: `Una fila representa una instancia de ${entity}; su granularidad exacta queda determinada por la PK, tenant y FKs principales.`,
    operationalRules: [
      {
        code: 'NO_ORPHAN_RECORDS',
        severity: 'HIGH',
        description: 'Toda relación debe resolver por FK física o validación lógica documentada.',
      },
      {
        code: 'REQUEST_TRACEABILITY',
        severity: 'HIGH',
        description: 'Toda escritura debe poder conectarse con endpoint, actor, request_id y timestamp.',
      },
    ],
    qualityRules: [
      {
        code: 'FIELD_CATALOG_REQUIRED',
        severity: 'HIGH',
        description: 'Cada columna debe existir en system_data_field_catalog con significado, fuente y uso.',
      },
      {
        code: 'ENUMS_CONTROLLED',
        severity: 'MEDIUM',
        description: 'Estados, tipos y reason codes deben controlarse por catálogo o contrato.',
      },
    ],
    relationshipsSummary,
    relationshipRationale: logical.length
      ? `La entidad participa en relaciones lógicas/físicas porque el flujo debe conectar datos de entrada, evidencia, decisión, resultado y auditoría: ${relationshipsSummary}.`
      : 'Las relaciones evitan islas de información y permiten recorrer el flujo desde payload hasta decisión, evidencia, notificación o caso operativo.',
    whoUses: ['ingeniería', 'operaciones', 'auditoría interna'],
  };
  if (domain === 'IDENTIDAD_KYC')
    return {
      ...base,
      process: 'Onboarding, verificación de identidad, contactabilidad y soporte de cliente.',
      whyStore:
        'Permite probar quién es el cliente, qué dato estaba vigente, qué evidencia lo respalda y si puede contactarse sin exponer PII innecesaria.',
      auditUsage:
        'Reconstruye identidad, documento, contacto, dirección, fuente, versión y evidencia usados en onboarding o decisión de crédito.',
      analysisUsage: 'Permite medir conversión KYC, calidad de perfiles, duplicados, contactabilidad, zonas y fricción de validación.',
      decisionUsage: 'Soporta aprobación, rechazo, reintento KYC, revisión manual, bloqueo y límites iniciales.',
      whoUses: ['operaciones KYC', 'riesgo crediticio', 'compliance', 'soporte', 'auditoría'],
    };
  if (domain === 'PRIVACIDAD')
    return {
      ...base,
      process: 'Gestión legal de consentimiento, finalidad, retención, clasificación y derechos del titular.',
      whyStore:
        'Permite demostrar que Atlas tenía autorización o base legal para tratar cada dato sensible, y cuándo debe dejar de conservarlo.',
      auditUsage: 'Reconstruye documento legal, versión, finalidad, canal, sesión, IP, dispositivo, otorgamiento y revocación.',
      analysisUsage: 'Permite medir aceptación/revocación, cumplimiento de SLA legal, datos sujetos a borrado y brechas de clasificación.',
      decisionUsage: 'Habilita o bloquea KYC, buró, scoring, marketing, notificaciones y procesamiento on-device.',
      whoUses: ['compliance', 'legal', 'riesgo', 'operaciones', 'auditoría'],
    };
  if (domain === 'DISPOSITIVO')
    return {
      ...base,
      process: 'Seguridad digital, device intelligence, sesión, SIM, IP y prevención de fraude temprano.',
      whyStore:
        'Permite detectar abuso antes de tener historial de pago: multi-cuenta, emulador, VPN, SIM swap, root o anomalías de sesión.',
      auditUsage: 'Reconstruye desde qué dispositivo, IP, SIM, sesión y versión de app ocurrió una acción crítica.',
      analysisUsage: 'Permite analizar fraude por dispositivo, estabilidad de sesión, reuse, geografía, carrier y versión de app.',
      decisionUsage: 'Puede elevar fricción, bloquear, abrir revisión manual o ajustar confianza del cliente/dispositivo.',
      whoUses: ['fraude', 'seguridad', 'riesgo', 'ingeniería móvil', 'auditoría'],
    };
  if (domain === 'RIESGO_CREDITO' || domain === 'CAPACIDAD_PAGO')
    return {
      ...base,
      process: 'Scoring, cálculo de features, evaluación crediticia, capacidad de pago y gobierno de variables.',
      whyStore: 'Permite explicar y reproducir decisiones crediticias; sin linaje y snapshots el score se vuelve caja negra.',
      auditUsage: 'Reconstruye modelo, reglas, variables, snapshot, contribuciones, score y resultado usados en una decisión.',
      analysisUsage: 'Permite backtesting, vintage analysis, estabilidad poblacional, performance de variables y monitoreo de drift.',
      decisionUsage: 'Define aprobación, rechazo, línea, revisión, bloqueo o política de capacidad de pago.',
      whoUses: ['analista financiero', 'riesgo crediticio', 'data science', 'operaciones', 'auditoría'],
    };
  if (domain === 'FRAUDE')
    return {
      ...base,
      process: 'Detección, investigación, revisión manual, watchlists y casos de fraude.',
      whyStore: 'Permite investigar patrones, sostener bloqueos, cerrar falsos positivos y actualizar reglas con evidencia.',
      auditUsage: 'Reconstruye alerta, caso, lista, match, actor, evidencia, decisión humana y resolución.',
      analysisUsage: 'Permite medir modus operandi, falsos positivos, reglas disparadas, tiempos de resolución y pérdidas evitadas.',
      decisionUsage: 'Soporta bloqueo, revisión, watchlist, escalamiento, descarte y mejora de reglas antifraude.',
      whoUses: ['fraude', 'riesgo', 'operaciones', 'legal', 'auditoría'],
    };
  if (domain === 'PROVEEDORES')
    return {
      ...base,
      process: 'Integraciones externas, enriquecimiento, costos, latencia, idempotencia y salud de proveedores.',
      whyStore: 'Permite saber qué fuente externa se consultó, qué costo/latencia tuvo y qué respuesta afectó una decisión.',
      auditUsage: 'Reconstruye llamada, payload hash, consentimiento, proveedor, respuesta normalizada/redactada y retención.',
      analysisUsage: 'Permite medir SLA, fallos, costo por proveedor, calidad de datos externos y dependencia operacional.',
      decisionUsage: 'Soporta retry, fallback, selección de proveedor, revisión manual y explicación de decisiones externas.',
      whoUses: ['integraciones', 'riesgo', 'compliance', 'finanzas', 'auditoría'],
    };
  if (domain === 'SISTEMAS_QA')
    return {
      ...base,
      process: 'Gobierno técnico del backend: endpoints, metadata, impactos, pruebas, stress y herramientas.',
      whyStore:
        'Permite operar el backend como plataforma auditable: cada endpoint debe conocer su payload, impacto, riesgo y pruebas asociadas.',
      auditUsage:
        'Reconstruye qué endpoints existen, qué tablas/campos impactan, qué pruebas los cubren y qué actor ejecutó acciones técnicas.',
      analysisUsage: 'Permite medir cobertura de catálogo, deuda de metadata, endpoints críticos, fallos de smoke y capacidad de stress.',
      decisionUsage: 'Soporta releases, pruebas, auditoría de cambios, priorización técnica y gobierno internacional.',
      whoUses: ['sistemas', 'QA', 'DevOps', 'auditoría técnica', 'producto'],
    };
  return base;
}

function fieldAuditUsage(row: ColumnRow): string {
  if (row.is_primary_key)
    return `Permite identificar de forma única la fila ${row.table_name} en auditorías, linaje e impactos de endpoints.`;
  if (row.is_foreign_key)
    return `Permite unir ${row.table_name} con ${row.referenced_table ?? 'tabla relacionada'} para reconstruir la cadena de evidencia y decisión.`;
  if (row.column_name.includes('hash')) return 'Permite buscar, deduplicar o hacer matching sin revelar el valor sensible original.';
  if (row.column_name.includes('encrypted'))
    return 'Permite custodiar el valor sensible con descifrado controlado y auditable cuando sea estrictamente necesario.';
  if (row.column_name.endsWith('_at') || row.column_name.includes('date'))
    return 'Permite reconstruir secuencia temporal, SLA, ventana de análisis y vigencia del dato.';
  if (row.column_name.includes('status') || row.column_name.includes('result'))
    return 'Permite auditar transiciones de estado, resultados operativos y decisiones finales.';
  if (row.column_name.includes('score'))
    return 'Permite revisar escala, fuente, versión y contribución de señales usadas por riesgo o fraude.';
  return `Permite revisar el valor ${row.table_name}.${row.column_name} contra payload, backend, fuente externa o regla operativa.`;
}

function fieldAnalysisUsage(row: ColumnRow): string {
  if (containsCapacitySignal(row.table_name, row.column_name))
    return 'Se puede usar para análisis de capacidad de pago, affordability, límites, mora y cohortes de comportamiento financiero.';
  if (containsFraudSignal(row.table_name, row.column_name))
    return 'Se puede usar para detección de patrones de fraude, abuso, multi-cuenta, listas y anomalías por ventana temporal.';
  if (isMlCandidate(row.table_name, row.column_name))
    return 'Puede agregarse por cohorts, ventanas, segmento o versión para scorecards, monitoreo de drift y reportes de performance.';
  if (row.is_foreign_key) return 'Permite joins gobernados para análisis relacional sin inferir conexiones manualmente.';
  return 'Sirve para segmentación operativa, control de completitud, filtros de soporte y monitoreo de calidad del dato.';
}

function fieldDecisionUsage(row: ColumnRow): string {
  if (containsCapacitySignal(row.table_name, row.column_name))
    return 'Puede influir en línea, límite, revisión por capacidad, reducción de exposición o política de affordability.';
  if (containsFraudSignal(row.table_name, row.column_name))
    return 'Puede influir en bloqueo, fricción adicional, revisión manual, watchlist o investigación antifraude.';
  if (/consent|privacy|retention|sensitive/.test(`${row.table_name}_${row.column_name}`))
    return 'Habilita o bloquea tratamiento de datos, proveedor externo, marketing, scoring o retención según finalidad legal.';
  if (/status|result|reason/.test(row.column_name))
    return 'Guía el siguiente paso operativo: continuar, bloquear, revisar, corregir, notificar o cerrar.';
  if (row.is_foreign_key) return 'Permite llegar a la entidad que soporta la decisión y validar que no existan datos huérfanos.';
  return 'Apoya decisiones indirectas de soporte, auditoría, calidad, gobierno o operación del flujo.';
}

function payloadPathsForColumn(row: ColumnRow): string[] {
  const source = sourceKind(row.column_name);
  if (source !== 'PAYLOAD') return [];
  return [`$.body.${row.column_name}`, `$.query.${row.column_name}`, `$.params.${row.column_name}`];
}

function fieldBusinessMeaning(tableName: string, columnName: string): string {
  const tableMeta = TABLE_METADATA.get(tableName);
  const tablePurpose = tableMeta?.whatDoes ?? `sostener el proceso ${humanize(tableName).toLowerCase()}`;
  if (columnName === '_id')
    return `Identificador técnico único de ${humanize(tableName)}. No es dato de negocio, pero permite unir esta fila con auditoría, impactos y relaciones sin ambigüedad.`;
  if (columnName === '_tenant_id')
    return `Identifica el tenant o país operativo dueño del registro. Es obligatorio para aislar información por operación, evitar cruces indebidos y escalar Atlas internacionalmente.`;
  if (columnName === '_created_at')
    return `Marca cuándo nació el registro. Sirve para reconstruir eventos, cohortes, ventanas de análisis, SLA y trazabilidad temporal.`;
  if (columnName === '_updated_at')
    return `Marca la última modificación de una entidad mutable. Sirve para detectar cambios recientes, stale data y auditar mantenimiento operativo.`;
  if (columnName === '_deleted')
    return `Bandera de borrado lógico. Permite ocultar registros al usuario sin destruir evidencia que puede requerirse por auditoría, soporte o cumplimiento.`;
  if (columnName.endsWith('_id'))
    return `Referencia que conecta ${humanize(tableName)} con otra entidad del flujo. Permite reconstruir de dónde viene la información y qué decisiones dependieron de ella.`;
  if (columnName.includes('hash'))
    return `Versión hasheada usada para búsqueda, deduplicación y matching sin exponer el dato sensible en claro.`;
  if (columnName.includes('encrypted'))
    return `Valor cifrado del dato sensible. Se conserva porque el negocio puede necesitar recuperarlo bajo permisos controlados y auditoría.`;
  if (columnName.includes('last_4')) return `Últimos caracteres visibles para soporte y conciliación sin revelar el dato completo.`;
  if (columnName.includes('status'))
    return `Estado de ciclo de vida. Determina si el registro está activo, pendiente, bloqueado, fallido o cerrado y guía la operación diaria.`;
  if (columnName.includes('reason_code'))
    return `Código de razón normalizado. Explica por qué ocurrió una decisión, rechazo, fallo o transición y permite análisis agregado sin leer notas libres.`;
  if (columnName.includes('score'))
    return `Puntaje cuantitativo que resume confianza, riesgo, similitud o calidad. Debe tener escala documentada para compararlo entre versiones.`;
  if (columnName.includes('gps') || columnName.includes('lat') || columnName.includes('lng'))
    return `Señal geográfica usada para consistencia de domicilio, prevención de fraude y análisis operativo por zona.`;
  if (columnName.includes('payload') || columnName.endsWith('_json'))
    return `Estructura JSON que guarda contexto flexible del proceso. Debe tener contrato para evitar convertirse en dato basura no gobernado.`;
  if (columnName.includes('version'))
    return `Versión funcional o técnica. Permite reproducir cómo se calculó, validó o decidió algo en un momento específico.`;
  if (columnName.includes('channel') || columnName.includes('source_type'))
    return `Canal o fuente de captura. Permite comparar comportamiento entre app, web, POS, backoffice o proveedor externo.`;
  if (columnName.includes('amount') || columnName.includes('value') || columnName.includes('cost'))
    return `Valor monetario o económico usado para medir riesgo, costo, capacidad, rentabilidad o impacto financiero.`;
  return `${humanize(columnName)} dentro de ${humanize(tableName)}. Existe porque ${tablePurpose}`;
}

function fieldTechnicalMeaning(row: ColumnRow): string {
  const fk = row.is_foreign_key ? ` Es FK hacia ${row.referenced_table ?? 'unknown'}.${row.referenced_column ?? 'unknown'}.` : '';
  const pk = row.is_primary_key ? ' Es PK y no debe reutilizarse.' : '';
  const nullable =
    row.is_nullable === 'YES'
      ? ' Admite null cuando el flujo todavía no generó ese dato.'
      : ' No admite null porque el flujo necesita este dato para ser válido.';
  return `Columna ${row.column_name} de tipo ${row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type}.${pk}${fk}${nullable}`;
}

function fieldWhyStore(tableName: string, columnName: string): string {
  const domain = classifyDomain(tableName);
  const domainName = DOMAIN_BUSINESS_METADATA.find((item) => item.domainCode === domain)?.domainName ?? domain;
  if (containsPii(tableName, columnName))
    return `Se guarda para ejecutar ${domainName} con privacidad por diseño: solo lo necesario, con hash/cifrado/masking cuando aplica y con trazabilidad de acceso.`;
  if (containsFraudSignal(tableName, columnName))
    return `Se guarda porque mejora la detección de abuso, dispositivos reutilizados, comportamiento anómalo y decisiones tempranas de revisión manual.`;
  if (containsCapacitySignal(tableName, columnName))
    return `Se guarda para evaluar capacidad o estabilidad del usuario y explicar decisiones de límite, aprobación o revisión.`;
  return `Se guarda para que ${domainName} pueda operar, auditarse y analizarse sin depender de logs externos o memoria del backend.`;
}

function fieldUsers(tableName: string, columnName: string): string[] {
  const users = ['ingeniería'];
  if (containsPii(tableName, columnName)) users.push('compliance', 'soporte autorizado');
  if (containsFraudSignal(tableName, columnName)) users.push('fraude', 'riesgo');
  if (containsCapacitySignal(tableName, columnName) || classifyDomain(tableName) === 'RIESGO_CREDITO')
    users.push('analista financiero', 'riesgo');
  if (/audit|log|event|status|reason/.test(`${tableName}_${columnName}`)) users.push('auditoría interna', 'operaciones');
  return [...new Set(users)];
}

function validationRules(row: ColumnRow): Record<string, unknown> {
  const rules: Record<string, unknown> = {
    nullable: row.is_nullable === 'YES',
    sqlType: row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type,
  };
  if (row.is_primary_key) rules.primaryKey = true;
  if (row.is_foreign_key) rules.foreignKey = { table: row.referenced_table, column: row.referenced_column };
  if (row.column_name.includes('status')) rules.catalogControlled = true;
  if (row.column_name.includes('email')) rules.format = 'email_or_email_domain';
  if (row.column_name.includes('phone')) rules.format = 'normalized_phone_or_hash';
  if (row.column_name.includes('gps') || row.column_name.endsWith('_lat')) rules.geoBounds = true;
  return rules;
}

function qualityRules(row: ColumnRow): unknown[] {
  const rules = [];
  if (row.is_nullable === 'NO') rules.push({ code: 'NOT_NULL', description: 'El campo no debe quedar vacío.' });
  if (row.is_foreign_key) rules.push({ code: 'FK_EXISTS', description: `Debe existir referencia en ${row.referenced_table}.` });
  if (row.column_name.includes('status'))
    rules.push({ code: 'CONTROLLED_STATUS', description: 'Debe pertenecer al catálogo operativo de estados.' });
  if (row.column_name.includes('score'))
    rules.push({ code: 'SCORE_SCALE_DOCUMENTED', description: 'La escala y versión del score debe estar documentada.' });
  if (row.column_name.endsWith('_json'))
    rules.push({ code: 'JSON_SCHEMA_VALID', description: 'El JSON debe validar contra contrato documentado.' });
  return rules;
}

function endpointPurpose(endpoint: EndpointScan): string {
  const module = moduleFromPath(endpoint.fullPath);
  if (endpoint.fullPath.includes('/health'))
    return 'Verificar salud técnica del backend, base de datos y dependencias críticas antes de operar el portal.';
  if (module === 'auth')
    return 'Autenticar o cerrar sesiones de actores internos/plataforma/cliente preservando trazabilidad de seguridad.';
  if (module === 'customer-onboarding')
    return 'Avanzar el onboarding del consumidor capturando identidad, consentimiento, dispositivo, permisos y evidencias requeridas.';
  if (module === 'risk' || endpoint.fullPath.includes('risk'))
    return 'Ejecutar o consultar evaluaciones de riesgo, reglas, features y resultados explicables para decisiones crediticias o antifraude.';
  if (module === 'systems')
    return 'Administrar el portal interno de sistemas: catálogo, pruebas, stress, impactos, auditoría técnica y gobierno de datos.';
  if (module === 'operations')
    return 'Dar visibilidad al equipo operativo sobre colas, casos, investigación, auditoría y calidad de datos.';
  if (module === 'external-data')
    return 'Orquestar consultas y evidencias de proveedores externos con trazabilidad, costo, consentimiento e idempotencia.';
  if (module === 'notifications') return 'Gestionar plantillas, mensajes, entregas y preferencias de comunicación.';
  if (module === 'sessions')
    return 'Registrar sesiones, heartbeats, ubicación y contexto técnico para seguridad, continuidad y antifraude.';
  return `Ejecutar la acción ${endpoint.handlerName ?? endpoint.method} del módulo ${module}.`;
}

function endpointRisk(endpoint: EndpointScan): string {
  if (endpoint.method === 'DELETE') return 'CRITICAL';
  if (
    /auth|risk|fraud|identity|consent|external-data|onboarding|systems\/.*(seed|stress|run|delete|trash|archive)/i.test(endpoint.fullPath)
  )
    return 'CRITICAL';
  if (endpoint.method !== 'GET') return 'HIGH';
  if (/operations|audit|systems|customers|sessions/i.test(endpoint.fullPath)) return 'HIGH';
  return 'LOW';
}

function endpointExpectedStatuses(endpoint: EndpointScan): number[] {
  if (endpoint.method === 'POST') return [201, 200, 400, 401, 403, 409, 422, 500];
  if (endpoint.method === 'PATCH') return [200, 400, 401, 403, 404, 409, 422, 500];
  if (endpoint.method === 'DELETE') return [200, 204, 400, 401, 403, 404, 409, 500];
  return [200, 400, 401, 403, 404, 500];
}

function contractReason(endpoint: EndpointScan, type: string): string {
  if (type === 'BODY')
    return `Define los datos que el cliente o usuario interno debe enviar para ${endpointPurpose(endpoint).toLowerCase()} Sin este contrato no se puede probar ni auditar qué datos entraron al backend.`;
  if (type === 'QUERY')
    return 'Define filtros, paginación y segmentación de lectura. Evita que el portal mande parámetros inexistentes o ambiguos.';
  if (type === 'PATH')
    return 'Define identificadores de ruta que seleccionan la entidad objetivo. Es clave para permisos, auditoría y trazabilidad.';
  return 'Define encabezados o respuesta esperada para pruebas e integración.';
}

function fieldsFromSchemaSource(schemaReference: string, controllerFile: string): ContractRef {
  const source = readFileSync(controllerFile, 'utf8');
  const importMatch = source.match(new RegExp(`import\s*\{[^}]*${schemaReference}[^}]*\}\s*from\s*['"]([^'"]+)['"]`));
  const schemaPath = importMatch ? join(controllerFile, '..', `${importMatch[1].replace(/\.js$/, '')}.ts`) : null;
  const ref: ContractRef = { schemaReference, dtoReference: null, schemaJson: { schemaReference }, required: [], optional: [], sample: {} };
  if (!schemaPath || !existsSync(schemaPath)) return ref;
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const typeMatch = schemaSource.match(new RegExp(`export\s+type\s+([A-Za-z0-9_]+)\s*=\s*z\.infer<\s*typeof\s+${schemaReference}\s*>`));
  ref.dtoReference = typeMatch?.[1] ?? null;
  const start = schemaSource.indexOf(`export const ${schemaReference}`);
  if (start === -1) return ref;
  const chunk = schemaSource.slice(start, start + 7000);
  const fieldLines = [...chunk.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*([^\n,]+)[,]?/gm)].filter(
    (match) => !['message', 'path', 'errorMap'].includes(match[1]),
  );
  const required: string[] = [];
  const optional: string[] = [];
  const schemaFields: Record<string, unknown> = {};
  for (const [, field, expression] of fieldLines) {
    const isOptional = /\.optional\(|\.default\(|\.nullable\(|\.nullish\(/.test(expression);
    if (isOptional) optional.push(field);
    else required.push(field);
    schemaFields[field] = { required: !isOptional, expression: expression.trim().slice(0, 240), source: 'zod_schema_static_scan' };
  }
  const uniqueRequired = [...new Set(required)].slice(0, 60);
  const uniqueOptional = [...new Set(optional)].filter((field) => !uniqueRequired.includes(field)).slice(0, 80);
  ref.required = uniqueRequired;
  ref.optional = uniqueOptional;
  ref.schemaJson = {
    schemaReference,
    dtoReference: ref.dtoReference,
    fields: schemaFields,
    sourceFile: relative(process.cwd(), schemaPath),
  };
  ref.sample = Object.fromEntries([...uniqueRequired, ...uniqueOptional].slice(0, 12).map((field) => [field, `<${field}>`]));
  return ref;
}

function scanControllers(): EndpointScan[] {
  const root = join(process.cwd(), 'src', 'modules');
  const files = walk(root).filter((file) => file.endsWith('.controller.ts'));
  const endpoints: EndpointScan[] = [];
  const controllerRegex = /@Controller\(([^)]*)\)[\s\S]*?export\s+class\s+([A-Za-z0-9_]+)\s*\{/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const controllers = [...source.matchAll(controllerRegex)];
    for (const controllerMatch of controllers) {
      const controllerPath = decoratorPath(controllerMatch[1]);
      const controllerName = controllerMatch[2];
      const classStart = controllerMatch.index ?? 0;
      const classEnd = controllers.find((next) => (next.index ?? 0) > classStart)?.index ?? source.length;
      const classBlock = source.slice(classStart, classEnd);
      const routeRegex = /@(Get|Post|Put|Patch|Delete|Options|Head)\(([^)]*)\)([\s\S]*?)(?:\n\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\()/g;
      for (const routeMatch of classBlock.matchAll(routeRegex)) {
        const method = routeMatch[1].toUpperCase();
        const routePath = decoratorPath(routeMatch[2]);
        const handlerName = routeMatch[4] ?? null;
        const signatureChunk = classBlock.slice(routeMatch.index ?? 0, (routeMatch.index ?? 0) + 1200);
        const fullPath = joinPaths(API_PREFIX, controllerPath, routePath);
        const bodySchema = signatureChunk.match(/@Body\(new ZodValidationPipe\(([A-Za-z0-9_]+)\)\)\s*[A-Za-z0-9_]+\s*:\s*([A-Za-z0-9_]+)/s);
        const querySchema = signatureChunk.match(
          /@Query\(new ZodValidationPipe\(([A-Za-z0-9_]+)\)\)\s*[A-Za-z0-9_]+\s*:\s*([A-Za-z0-9_]+)/s,
        );
        const paramSchema = signatureChunk.match(
          /@Param\(new ZodValidationPipe\(([A-Za-z0-9_]+)\)\)\s*[A-Za-z0-9_]+\s*:\s*([A-Za-z0-9_]+)/s,
        );
        endpoints.push({
          method,
          fullPath,
          controllerName,
          handlerName,
          sourceFile: relative(process.cwd(), file),
          bodySchema: bodySchema ? fieldsFromSchemaSource(bodySchema[1], file) : undefined,
          querySchema: querySchema ? fieldsFromSchemaSource(querySchema[1], file) : undefined,
          paramSchema: paramSchema ? fieldsFromSchemaSource(paramSchema[1], file) : undefined,
        });
      }
    }
  }
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.method} ${endpoint.fullPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function impactedTablesFor(endpoint: EndpointScan): { reads: string[]; writes: string[] } {
  const p = endpoint.fullPath;
  const m = moduleFromPath(p);
  if (m === 'auth')
    return {
      reads: ['auth_credentials', 'internal_users', 'platform_users', 'customers'],
      writes: ['auth_events', 'customer_sessions', 'auth_refresh_tokens', 'system_action_logs'],
    };
  if (m === 'customer-onboarding')
    return {
      reads: ['customers', 'consent_documents', 'privacy_processing_purposes'],
      writes: [
        'customers',
        'customer_profile_versions',
        'customer_contact_methods',
        'customer_consents',
        'devices',
        'customer_sessions',
        'onboarding_flows',
        'permission_events',
        'evidence_documents',
        'identity_verification_attempts',
        'customer_address_versions',
      ],
    };
  if (m === 'customers')
    return {
      reads: ['customers', 'customer_profile_versions', 'customer_contact_methods', 'customer_addresses'],
      writes: endpoint.method === 'GET' ? [] : ['customers', 'customer_profile_versions'],
    };
  if (m === 'sessions')
    return {
      reads: ['customer_sessions', 'devices', 'customers'],
      writes: ['customer_sessions', 'device_snapshots', 'address_gps_observations', 'customer_action_logs'],
    };
  if (m === 'risk' || p.includes('risk'))
    return {
      reads: ['customers', 'feature_values', 'feature_snapshots', 'risk_model_versions', 'risk_ruleset_versions'],
      writes: [
        'risk_assessment_runs',
        'risk_assessment_contexts',
        'risk_assessment_results',
        'risk_rules_fired',
        'risk_feature_contributions',
        'manual_review_cases',
      ],
    };
  if (m === 'fraud')
    return {
      reads: ['fraud_cases', 'watchlist_matches', 'manual_review_cases'],
      writes: endpoint.method === 'GET' ? [] : ['fraud_cases', 'fraud_case_events', 'watchlist_matches', 'manual_review_events'],
    };
  if (m === 'external-data')
    return {
      reads: ['data_providers', 'customer_consents', 'provider_health_logs'],
      writes: ['data_provider_requests', 'data_provider_responses', 'evidence_documents', 'provider_health_logs', 'outbox_events'],
    };
  if (m === 'catalog-management')
    return {
      reads: [
        'context_catalogs',
        'context_items',
        'observation_definitions',
        'attribute_definitions',
        'feature_definitions',
        'risk_policy_rules',
      ],
      writes:
        endpoint.method === 'GET'
          ? []
          : ['context_catalogs', 'context_items', 'context_catalog_versions', 'context_approval_events', 'data_quality_issues'],
    };
  if (m === 'notifications')
    return {
      reads: ['notification_templates', 'user_notification_preferences', 'device_tokens'],
      writes: endpoint.method === 'GET' ? [] : ['notification_messages', 'notification_deliveries', 'outbox_events'],
    };
  if (m === 'operations')
    return {
      reads: [
        'manual_review_cases',
        'fraud_cases',
        'risk_assessment_runs',
        'data_quality_issues',
        'operational_audit_logs',
        'system_action_logs',
      ],
      writes: [],
    };
  if (m === 'data-quality')
    return { reads: ['data_quality_rules', 'data_quality_issues'], writes: endpoint.method === 'GET' ? [] : ['data_quality_issues'] };
  if (m === 'systems')
    return {
      reads: [
        'system_endpoint_catalog',
        'system_data_entity_catalog',
        'system_data_field_catalog',
        'system_data_relationship_catalog',
        'system_operational_rule_catalog',
        'system_test_suites',
      ],
      writes:
        endpoint.method === 'GET' ? [] : ['system_test_runs', 'system_test_step_runs', 'system_stress_profiles', 'system_action_logs'],
    };
  return { reads: [], writes: endpoint.method === 'GET' ? [] : [] };
}

async function upsertDomain(queryInterface: QueryInterface, domain: (typeof DOMAIN_BUSINESS_METADATA)[number]) {
  await queryInterface.sequelize.query(
    `INSERT INTO system_domain_catalog (
      domain_code, domain_name, description, business_definition, technical_scope, data_nature, owner_team,
      countries_applicable, regulatory_notes, example_tables, decision_use_cases, audit_relevance, status, _created_at, _updated_at
    ) VALUES (
      :domainCode, :domainName, :description, :businessDefinition, :technicalScope, :dataNature, :ownerTeam,
      '["BOL","MULTI_COUNTRY_READY"]'::jsonb, :regulatoryNotes, CAST(:exampleTables AS jsonb), CAST(:decisionUseCases AS jsonb), :auditRelevance, 'ACTIVE', :createdAt, :createdAt
    ) ON CONFLICT (domain_code) DO UPDATE SET
      domain_name = EXCLUDED.domain_name,
      description = EXCLUDED.description,
      business_definition = EXCLUDED.business_definition,
      technical_scope = EXCLUDED.technical_scope,
      data_nature = EXCLUDED.data_nature,
      owner_team = EXCLUDED.owner_team,
      example_tables = EXCLUDED.example_tables,
      decision_use_cases = EXCLUDED.decision_use_cases,
      audit_relevance = EXCLUDED.audit_relevance,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        ...domain,
        businessDefinition: domain.businessDefinition,
        technicalScope: domain.technicalScope,
        ownerTeam: domain.ownerTeam,
        regulatoryNotes: domain.regulatoryNotes,
        exampleTables: JSON.stringify(domain.exampleTables),
        decisionUseCases: JSON.stringify(domain.decisionUseCases),
        auditRelevance: domain.auditRelevance,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertEndpoint(queryInterface: QueryInterface, endpoint: EndpointScan) {
  const code = buildEndpointCode(endpoint.method, endpoint.fullPath);
  const body = endpoint.bodySchema?.schemaJson ?? {};
  const query = endpoint.querySchema?.schemaJson ?? {};
  const params = endpoint.paramSchema?.schemaJson ?? {};
  const riskLevel = endpointRisk(endpoint);
  const impacts = impactedTablesFor(endpoint);
  await queryInterface.sequelize.query(
    `INSERT INTO system_endpoint_catalog (
      code, module, controller_name, handler_name, method, route_path, full_path, route_name,
      business_purpose, business_action, technical_purpose, business_value, audit_strategy, decision_use_cases,
      expected_response_summary, expected_status_codes, min_payload_schema, query_params_schema, path_params_schema, headers_schema,
      input_payload_contract, output_contract, payload_origin_summary, side_effects_summary, metadata_completeness_score,
      requires_auth, allowed_roles, contains_pii, pii_fields, risk_level, is_destructive, is_readonly, idempotency_required,
      requires_stress_test, requires_integration_test, is_testable_from_portal, test_environment_only, owner_team, status,
      version, detected_from, confidence_level, review_status, source_file, created_by, updated_by, _created_at, _updated_at
    ) VALUES (
      :code, :module, :controllerName, :handlerName, :method, :routePath, :fullPath, :routeName,
      :businessPurpose, :businessAction, :technicalPurpose, :businessValue, :auditStrategy, CAST(:decisionUseCases AS jsonb),
      :expectedResponseSummary, CAST(:expectedStatusCodes AS jsonb), CAST(:minPayloadSchema AS jsonb), CAST(:queryParamsSchema AS jsonb), CAST(:pathParamsSchema AS jsonb), '{}'::jsonb,
      CAST(:inputPayloadContract AS jsonb), CAST(:outputContract AS jsonb), :payloadOriginSummary, :sideEffectsSummary, :metadataCompletenessScore,
      true, '[]'::jsonb, :containsPii, CAST(:piiFields AS jsonb), :riskLevel, :isDestructive, :isReadonly, :idempotencyRequired,
      :requiresStressTest, :requiresIntegrationTest, true, true, :ownerTeam, 'ACTIVE',
      'v1', 'controller_scan_enriched', 'HIGH', 'AUTO_DETECTED', :sourceFile, 'rich_metadata_seed', 'rich_metadata_seed', :createdAt, :createdAt
    ) ON CONFLICT (method, full_path) DO UPDATE SET
      controller_name = EXCLUDED.controller_name,
      handler_name = EXCLUDED.handler_name,
      route_name = EXCLUDED.route_name,
      business_purpose = EXCLUDED.business_purpose,
      business_action = EXCLUDED.business_action,
      technical_purpose = EXCLUDED.technical_purpose,
      business_value = EXCLUDED.business_value,
      audit_strategy = EXCLUDED.audit_strategy,
      decision_use_cases = EXCLUDED.decision_use_cases,
      expected_response_summary = EXCLUDED.expected_response_summary,
      expected_status_codes = EXCLUDED.expected_status_codes,
      min_payload_schema = EXCLUDED.min_payload_schema,
      query_params_schema = EXCLUDED.query_params_schema,
      path_params_schema = EXCLUDED.path_params_schema,
      input_payload_contract = EXCLUDED.input_payload_contract,
      output_contract = EXCLUDED.output_contract,
      payload_origin_summary = EXCLUDED.payload_origin_summary,
      side_effects_summary = EXCLUDED.side_effects_summary,
      metadata_completeness_score = EXCLUDED.metadata_completeness_score,
      contains_pii = EXCLUDED.contains_pii,
      pii_fields = EXCLUDED.pii_fields,
      risk_level = EXCLUDED.risk_level,
      is_destructive = EXCLUDED.is_destructive,
      is_readonly = EXCLUDED.is_readonly,
      idempotency_required = EXCLUDED.idempotency_required,
      requires_stress_test = EXCLUDED.requires_stress_test,
      requires_integration_test = EXCLUDED.requires_integration_test,
      is_testable_from_portal = EXCLUDED.is_testable_from_portal,
      detected_from = EXCLUDED.detected_from,
      confidence_level = EXCLUDED.confidence_level,
      review_status = EXCLUDED.review_status,
      source_file = EXCLUDED.source_file,
      updated_by = EXCLUDED.updated_by,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        code,
        module: moduleFromPath(endpoint.fullPath),
        controllerName: endpoint.controllerName,
        handlerName: endpoint.handlerName,
        method: endpoint.method,
        routePath: endpoint.fullPath.replace(API_PREFIX, ''),
        fullPath: endpoint.fullPath,
        routeName: routeNameFromMethodAndPath(endpoint.method, endpoint.fullPath),
        businessPurpose: endpointPurpose(endpoint),
        businessAction: endpoint.handlerName ?? endpoint.method,
        technicalPurpose: `Expone ${endpoint.method} ${endpoint.fullPath} desde ${endpoint.controllerName ?? 'controller'} y valida entrada mediante Zod cuando existe contrato explícito.`,
        businessValue: `Permite que el portal y los clientes técnicos prueben el flujo sin depender de conocimiento tribal. Impacta tablas de lectura: ${impacts.reads.join(', ') || 'sin lectura principal'}; escritura: ${impacts.writes.join(', ') || 'sin escritura principal'}.`,
        auditStrategy: `Registrar system_action_logs con request_id, actor, payload saneado, duración, status code y endpoint_catalog_id. Para escrituras, auditar además cambios de tablas impactadas y razón de negocio.`,
        decisionUseCases: JSON.stringify([
          'pruebas desde portal',
          'auditoría de API',
          'análisis de fallos',
          'stress test controlado',
          'trazabilidad de datos impactados',
        ]),
        expectedResponseSummary:
          endpoint.method === 'GET'
            ? 'Respuesta de lectura paginada o detalle según ruta.'
            : 'Respuesta de creación/actualización con entidad, estado de proceso o acuse operativo.',
        expectedStatusCodes: JSON.stringify(endpointExpectedStatuses(endpoint)),
        minPayloadSchema: JSON.stringify(body),
        queryParamsSchema: JSON.stringify(query),
        pathParamsSchema: JSON.stringify(params),
        inputPayloadContract: JSON.stringify({ body, query, params }),
        outputContract: JSON.stringify({
          expectedStatusCodes: endpointExpectedStatuses(endpoint),
          responseShape: endpoint.method === 'GET' ? 'read_model_or_paginated_items' : 'command_result_or_created_resource',
        }),
        payloadOriginSummary: endpoint.bodySchema
          ? 'BODY validado por ZodValidationPipe; campos transformados/escritos por servicios del backend.'
          : 'Sin BODY declarado; entrada por query/path params o proceso interno del backend.',
        sideEffectsSummary: impacts.writes.length
          ? `Puede escribir o detonar cambios en ${impacts.writes.join(', ')}.`
          : 'No debe modificar estado de negocio; endpoint de lectura o salud.',
        metadataCompletenessScore: endpoint.bodySchema || endpoint.querySchema || endpoint.paramSchema ? 95 : 80,
        containsPii: /customer|identity|contact|phone|email|address|session|auth|consent|evidence/i.test(endpoint.fullPath),
        piiFields: JSON.stringify(
          [...(endpoint.bodySchema?.required ?? []), ...(endpoint.querySchema?.required ?? [])].filter((f) =>
            /phone|email|name|address|document|token|password|ip|gps|session/i.test(f),
          ),
        ),
        riskLevel,
        isDestructive: endpoint.method === 'DELETE',
        isReadonly: endpoint.method === 'GET',
        idempotencyRequired: endpoint.method !== 'GET' && endpoint.method !== 'DELETE',
        requiresStressTest: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
        requiresIntegrationTest: riskLevel !== 'LOW',
        ownerTeam: moduleFromPath(endpoint.fullPath),
        sourceFile: endpoint.sourceFile,
        createdAt: CREATED_AT,
      },
    },
  );
}

function inferredContract(endpoint: EndpointScan, type: 'BODY' | 'QUERY' | 'PATH'): ContractRef | null {
  if (type === 'BODY' && endpoint.method === 'GET') return null;
  const routeParams = [...endpoint.fullPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  if (type === 'PATH' && routeParams.length === 0) return null;
  const fields = type === 'PATH' ? routeParams : type === 'QUERY' ? ['page', 'limit'] : [];
  return {
    schemaReference: `INFERRED_${type}_${buildEndpointCode(endpoint.method, endpoint.fullPath)}`.slice(0, 180),
    dtoReference: null,
    schemaJson: {
      inferred: true,
      reason: 'No se detectó ZodValidationPipe explícito en el controller; se deja contrato semilla para revisión manual.',
      expectedFields: fields,
    },
    required: type === 'PATH' ? fields : [],
    optional: type === 'QUERY' ? fields : [],
    sample: Object.fromEntries(fields.map((field) => [field, `<${field}>`])),
  };
}

async function upsertPayloadContract(
  queryInterface: QueryInterface,
  endpoint: EndpointScan,
  type: 'BODY' | 'QUERY' | 'PATH',
  contract?: ContractRef,
) {
  const effectiveContract = contract ?? inferredContract(endpoint, type);
  if (!effectiveContract) return;
  const inferred = !contract;
  const endpointRows = await queryInterface.sequelize.query<{ _id: string }>(
    `SELECT _id FROM system_endpoint_catalog WHERE method = :method AND full_path = :fullPath LIMIT 1`,
    { replacements: { method: endpoint.method, fullPath: endpoint.fullPath }, type: QueryTypes.SELECT },
  );
  const endpointId = endpointRows[0]?._id;
  if (!endpointId) return;
  await queryInterface.sequelize.query(
    `INSERT INTO system_endpoint_payload_contracts (
      endpoint_id, contract_type, schema_reference, dto_reference, schema_json, required_fields_json, optional_fields_json,
      sample_payload_json, business_reason, validation_layer, source_file, confidence_level, review_status, _created_at, _updated_at
    ) VALUES (
      :endpointId, :contractType, :schemaReference, :dtoReference, CAST(:schemaJson AS jsonb), CAST(:requiredFields AS jsonb), CAST(:optionalFields AS jsonb),
      CAST(:samplePayload AS jsonb), :businessReason, :validationLayer, :sourceFile, :confidenceLevel, :reviewStatus, :createdAt, :createdAt
    ) ON CONFLICT (endpoint_id, contract_type, COALESCE(schema_reference, '')) DO UPDATE SET
      dto_reference = EXCLUDED.dto_reference,
      schema_json = EXCLUDED.schema_json,
      required_fields_json = EXCLUDED.required_fields_json,
      optional_fields_json = EXCLUDED.optional_fields_json,
      sample_payload_json = EXCLUDED.sample_payload_json,
      business_reason = EXCLUDED.business_reason,
      validation_layer = EXCLUDED.validation_layer,
      confidence_level = EXCLUDED.confidence_level,
      review_status = EXCLUDED.review_status,
      source_file = EXCLUDED.source_file,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        endpointId,
        contractType: type,
        schemaReference: effectiveContract.schemaReference,
        dtoReference: effectiveContract.dtoReference,
        schemaJson: JSON.stringify(effectiveContract.schemaJson),
        requiredFields: JSON.stringify(effectiveContract.required),
        optionalFields: JSON.stringify(effectiveContract.optional),
        samplePayload: JSON.stringify(effectiveContract.sample),
        businessReason: inferred
          ? `${contractReason(endpoint, type)} Contrato inferido: requiere revisión antes de producción internacional.`
          : contractReason(endpoint, type),
        validationLayer: inferred ? 'INFERRED_FROM_ROUTE_REVIEW_REQUIRED' : 'ZOD_VALIDATION_PIPE',
        confidenceLevel: inferred ? 'MEDIUM' : 'HIGH',
        reviewStatus: inferred ? 'NEEDS_REVIEW' : 'AUTO_DETECTED',
        sourceFile: endpoint.sourceFile,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertDataEntity(queryInterface: QueryInterface, tableName: string) {
  const domainCode = classifyDomain(tableName);
  const meta = TABLE_METADATA.get(tableName);
  const entityName = humanize(tableName);
  const context = entityContext(tableName);
  const businessPurpose = meta?.whatDoes ?? context.process;
  await queryInterface.sequelize.query(
    `INSERT INTO system_data_entity_catalog (
      schema_name, table_name, model_name, entity_name, module, business_purpose, description, technical_purpose,
      business_process, why_store, who_uses, audit_usage, analysis_usage, decision_usage, data_nature, domain_code,
      data_grain, source_system, operational_rules_json, quality_rules_json, key_relationships_summary, relationship_rationale,
      internationalization_notes, data_owner, contains_pii, contains_financial_data, contains_risk_data, contains_legal_data,
      contains_device_data, contains_location_data, is_audit_critical, retention_policy_code, status, detected_from,
      confidence_level, review_status, _created_at, _updated_at
    ) VALUES (
      'public', :tableName, null, :entityName, :module, :businessPurpose, :description, :technicalPurpose,
      :businessProcess, :whyStore, CAST(:whoUses AS jsonb), :auditUsage, :analysisUsage, :decisionUsage, :dataNature, :domainCode,
      :dataGrain, 'atlas-backend', CAST(:operationalRules AS jsonb), CAST(:qualityRules AS jsonb), :relationshipsSummary, :relationshipRationale,
      :internationalizationNotes, :dataOwner, :containsPii, :containsFinancial, :containsRisk, :containsLegal,
      :containsDevice, :containsLocation, :auditCritical, :retentionPolicy, 'ACTIVE', 'information_schema_enriched',
      'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
    ) ON CONFLICT (schema_name, table_name) DO UPDATE SET
      business_purpose = EXCLUDED.business_purpose,
      description = EXCLUDED.description,
      technical_purpose = EXCLUDED.technical_purpose,
      business_process = EXCLUDED.business_process,
      why_store = EXCLUDED.why_store,
      who_uses = EXCLUDED.who_uses,
      audit_usage = EXCLUDED.audit_usage,
      analysis_usage = EXCLUDED.analysis_usage,
      decision_usage = EXCLUDED.decision_usage,
      data_nature = EXCLUDED.data_nature,
      domain_code = EXCLUDED.domain_code,
      data_grain = EXCLUDED.data_grain,
      source_system = EXCLUDED.source_system,
      operational_rules_json = EXCLUDED.operational_rules_json,
      quality_rules_json = EXCLUDED.quality_rules_json,
      key_relationships_summary = EXCLUDED.key_relationships_summary,
      relationship_rationale = EXCLUDED.relationship_rationale,
      internationalization_notes = EXCLUDED.internationalization_notes,
      contains_pii = EXCLUDED.contains_pii,
      contains_financial_data = EXCLUDED.contains_financial_data,
      contains_risk_data = EXCLUDED.contains_risk_data,
      contains_legal_data = EXCLUDED.contains_legal_data,
      contains_device_data = EXCLUDED.contains_device_data,
      contains_location_data = EXCLUDED.contains_location_data,
      is_audit_critical = EXCLUDED.is_audit_critical,
      retention_policy_code = EXCLUDED.retention_policy_code,
      detected_from = EXCLUDED.detected_from,
      confidence_level = EXCLUDED.confidence_level,
      review_status = EXCLUDED.review_status,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        tableName,
        entityName,
        module: moduleFromTable(tableName),
        businessPurpose,
        description: meta?.whatIs ?? `Entidad ${entityName} del backend Atlas.`,
        technicalPurpose: `Persistir ${entityName} en PostgreSQL con trazabilidad por timestamps, relaciones, contratos de endpoint y reglas de gobierno de datos.`,
        businessProcess: context.process,
        whyStore: context.whyStore,
        whoUses: JSON.stringify(context.whoUses),
        auditUsage: context.auditUsage,
        analysisUsage: context.analysisUsage,
        decisionUsage: context.decisionUsage,
        dataNature: natureFromDomain(domainCode),
        domainCode,
        dataGrain: context.dataGrain,
        operationalRules: JSON.stringify(context.operationalRules),
        qualityRules: JSON.stringify(context.qualityRules),
        relationshipsSummary: context.relationshipsSummary,
        relationshipRationale: context.relationshipRationale,
        internationalizationNotes:
          'Debe conservar tenant, país, moneda, zona horaria, versión legal y fuente de dato para escalar fuera de Bolivia sin rediseñar el modelo.',
        dataOwner: DOMAIN_OWNER_FALLBACK[domainCode] ?? 'risk-operations',
        containsPii: /customer|identity|contact|address|consent|evidence|session|auth/.test(tableName),
        containsFinancial: /payment|credit|amount|value|cost|limit|settlement|merchant|mdr|debt|feature/.test(tableName),
        containsRisk: /risk|fraud|feature|observation|attribute|watchlist|device|sim|ip_reputation|quality/.test(tableName),
        containsLegal: /consent|privacy|retention|classification|sensitive|subject/.test(tableName),
        containsDevice: /device|sim|ip_reputation|session/.test(tableName),
        containsLocation: /gps|address|location/.test(tableName),
        auditCritical: /audit|log|event|risk|fraud|consent|identity|payment|system_|outbox|idempotency/.test(tableName),
        retentionPolicy: /evidence|response|consent|identity|customer|session/.test(tableName) ? 'RETENTION_PRIVACY_AND_AUDIT' : null,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function upsertField(queryInterface: QueryInterface, row: ColumnRow) {
  const entity = await queryInterface.sequelize.query<{ _id: string }>(
    `SELECT _id FROM system_data_entity_catalog WHERE schema_name = 'public' AND table_name = :tableName LIMIT 1`,
    { replacements: { tableName: row.table_name }, type: QueryTypes.SELECT },
  );
  const domainCode = classifyDomain(row.table_name);
  const pii = containsPii(row.table_name, row.column_name);
  const fraud = containsFraudSignal(row.table_name, row.column_name);
  const capacity = containsCapacitySignal(row.table_name, row.column_name);
  await queryInterface.sequelize.query(
    `INSERT INTO system_data_field_catalog (
      data_entity_id, schema_name, table_name, column_name, ordinal_position, sql_data_type, is_nullable, column_default,
      is_primary_key, is_foreign_key, referenced_schema, referenced_table, referenced_column, business_name, business_meaning,
      technical_meaning, why_store, who_uses, audit_usage, analysis_usage, decision_usage, source_kind, payload_paths_json,
      backend_write_behavior, data_nature, domain_code, governance_category, classification_code, sensitivity_level,
      contains_pii, contains_financial_data, contains_risk_data, contains_fraud_signal, contains_capacity_signal,
      is_ml_candidate, ml_feature_group, quality_rules_json, validation_rule_json, retention_policy_code, frontend_label,
      form_usage, relationship_notes, operational_notes, source_document, confidence_level, review_status, _created_at, _updated_at
    ) VALUES (
      :dataEntityId, 'public', :tableName, :columnName, :ordinalPosition, :sqlDataType, :isNullable, :columnDefault,
      :isPrimaryKey, :isForeignKey, :referencedSchema, :referencedTable, :referencedColumn, :businessName, :businessMeaning,
      :technicalMeaning, :whyStore, CAST(:whoUses AS jsonb), :auditUsage, :analysisUsage, :decisionUsage, :sourceKind, CAST(:payloadPaths AS jsonb),
      :backendWriteBehavior, :dataNature, :domainCode, :governanceCategory, :classificationCode, :sensitivityLevel,
      :containsPii, :containsFinancial, :containsRisk, :containsFraud, :containsCapacity,
      :isMlCandidate, :mlFeatureGroup, CAST(:qualityRules AS jsonb), CAST(:validationRule AS jsonb), :retentionPolicyCode, :frontendLabel,
      :formUsage, :relationshipNotes, :operationalNotes, 'information_schema+schema_v5_2_pdf', 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
    ) ON CONFLICT (schema_name, table_name, column_name) DO UPDATE SET
      data_entity_id = EXCLUDED.data_entity_id,
      ordinal_position = EXCLUDED.ordinal_position,
      sql_data_type = EXCLUDED.sql_data_type,
      is_nullable = EXCLUDED.is_nullable,
      column_default = EXCLUDED.column_default,
      is_primary_key = EXCLUDED.is_primary_key,
      is_foreign_key = EXCLUDED.is_foreign_key,
      referenced_schema = EXCLUDED.referenced_schema,
      referenced_table = EXCLUDED.referenced_table,
      referenced_column = EXCLUDED.referenced_column,
      business_name = EXCLUDED.business_name,
      business_meaning = EXCLUDED.business_meaning,
      technical_meaning = EXCLUDED.technical_meaning,
      why_store = EXCLUDED.why_store,
      who_uses = EXCLUDED.who_uses,
      audit_usage = EXCLUDED.audit_usage,
      analysis_usage = EXCLUDED.analysis_usage,
      decision_usage = EXCLUDED.decision_usage,
      source_kind = EXCLUDED.source_kind,
      backend_write_behavior = EXCLUDED.backend_write_behavior,
      data_nature = EXCLUDED.data_nature,
      domain_code = EXCLUDED.domain_code,
      governance_category = EXCLUDED.governance_category,
      classification_code = EXCLUDED.classification_code,
      sensitivity_level = EXCLUDED.sensitivity_level,
      contains_pii = EXCLUDED.contains_pii,
      contains_financial_data = EXCLUDED.contains_financial_data,
      contains_risk_data = EXCLUDED.contains_risk_data,
      contains_fraud_signal = EXCLUDED.contains_fraud_signal,
      contains_capacity_signal = EXCLUDED.contains_capacity_signal,
      is_ml_candidate = EXCLUDED.is_ml_candidate,
      ml_feature_group = EXCLUDED.ml_feature_group,
      quality_rules_json = EXCLUDED.quality_rules_json,
      validation_rule_json = EXCLUDED.validation_rule_json,
      retention_policy_code = EXCLUDED.retention_policy_code,
      frontend_label = EXCLUDED.frontend_label,
      form_usage = EXCLUDED.form_usage,
      relationship_notes = EXCLUDED.relationship_notes,
      operational_notes = EXCLUDED.operational_notes,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        dataEntityId: entity[0]?._id ?? null,
        tableName: row.table_name,
        columnName: row.column_name,
        ordinalPosition: row.ordinal_position,
        sqlDataType: row.data_type === 'USER-DEFINED' ? row.udt_name : row.data_type,
        isNullable: row.is_nullable === 'YES',
        columnDefault: row.column_default,
        isPrimaryKey: row.is_primary_key,
        isForeignKey: row.is_foreign_key,
        referencedSchema: row.referenced_schema,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
        businessName: humanize(row.column_name),
        businessMeaning: fieldBusinessMeaning(row.table_name, row.column_name),
        technicalMeaning: fieldTechnicalMeaning(row),
        whyStore: fieldWhyStore(row.table_name, row.column_name),
        whoUses: JSON.stringify(fieldUsers(row.table_name, row.column_name)),
        auditUsage: fieldAuditUsage(row),
        analysisUsage: fieldAnalysisUsage(row),
        decisionUsage: fieldDecisionUsage(row),
        sourceKind: sourceKind(row.column_name),
        payloadPaths: JSON.stringify(payloadPathsForColumn(row)),
        backendWriteBehavior:
          sourceKind(row.column_name) === 'PAYLOAD'
            ? 'Recibido desde payload y persistido solo después de validación, normalización y autorización de negocio.'
            : 'Escrito o calculado por backend, trigger, reloj del sistema, hash/cifrado, proveedor externo o relación interna.',
        dataNature: natureFromDomain(domainCode),
        domainCode,
        governanceCategory: pii ? 'PRIVACIDAD' : fraud ? 'FRAUDE' : capacity ? 'CAPACIDAD' : 'OPERACIONAL',
        classificationCode: pii ? 'PERSONAL_SENSITIVE' : fraud ? 'RISK_SIGNAL' : capacity ? 'CAPACITY_SIGNAL' : 'INTERNAL_OPERATIONAL',
        sensitivityLevel: pii ? 'RESTRICTED' : fraud || capacity ? 'CONFIDENTIAL' : 'INTERNAL',
        containsPii: pii,
        containsFinancial: containsFinancial(row.table_name, row.column_name),
        containsRisk: /risk|score|feature|observation|attribute|quality|status|reason/.test(`${row.table_name}_${row.column_name}`),
        containsFraud: fraud,
        containsCapacity: capacity,
        isMlCandidate: isMlCandidate(row.table_name, row.column_name),
        mlFeatureGroup: mlGroup(row.table_name, row.column_name),
        qualityRules: JSON.stringify(qualityRules(row)),
        validationRule: JSON.stringify(validationRules(row)),
        retentionPolicyCode: pii ? 'RETENTION_PRIVACY_AND_AUDIT' : null,
        frontendLabel: humanize(row.column_name),
        formUsage:
          sourceKind(row.column_name) === 'PAYLOAD'
            ? 'Puede aparecer en formularios o DTOs únicamente si el endpoint declara contrato y finalidad de negocio.'
            : 'No debe ser solicitado directamente en formulario; debe ser generado, calculado o leído por backend según gobierno.',
        relationshipNotes: row.is_foreign_key
          ? `Relaciona con ${row.referenced_table ?? 'unknown'}.${row.referenced_column ?? 'unknown'}; esta relación debe ser visible en el mapa de linaje.`
          : null,
        operationalNotes: row.column_name.includes('status')
          ? 'Usar catálogo de estados, reason_code y evento append-only para cada transición relevante.'
          : null,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function seedColumns(queryInterface: QueryInterface) {
  const rows = await queryInterface.sequelize.query<ColumnRow>(
    `SELECT
      c.table_name,
      c.column_name,
      c.ordinal_position,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND kcu.column_name = c.column_name
      ) AS is_primary_key,
      fk.referenced_table IS NOT NULL AS is_foreign_key,
      fk.referenced_schema,
      fk.referenced_table,
      fk.referenced_column
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name, ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
    ) fk ON fk.table_schema = c.table_schema AND fk.table_name = c.table_name AND fk.column_name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name NOT IN ('SequelizeMeta','SequelizeDataSeeders')
    ORDER BY c.table_name, c.ordinal_position`,
    { type: QueryTypes.SELECT },
  );
  const tableNames = [...new Set(rows.map((row) => row.table_name))];
  for (const tableName of tableNames) await upsertDataEntity(queryInterface, tableName);
  for (const row of rows) await upsertField(queryInterface, row);
}

async function seedRelationships(queryInterface: QueryInterface) {
  const rows = await queryInterface.sequelize.query<ColumnRow>(
    `SELECT kcu.table_name, kcu.column_name, ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
     ORDER BY kcu.table_name, kcu.column_name`,
    { type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    const sourceEntity = await queryInterface.sequelize.query<{ _id: string }>(
      `SELECT _id FROM system_data_entity_catalog WHERE table_name = :tableName LIMIT 1`,
      { replacements: { tableName: row.table_name }, type: QueryTypes.SELECT },
    );
    const targetEntity = await queryInterface.sequelize.query<{ _id: string }>(
      `SELECT _id FROM system_data_entity_catalog WHERE table_name = :tableName LIMIT 1`,
      { replacements: { tableName: row.referenced_table }, type: QueryTypes.SELECT },
    );
    await queryInterface.sequelize.query(
      `INSERT INTO system_data_relationship_catalog (
        source_data_entity_id, target_data_entity_id, source_schema, source_table, source_column, target_schema, target_table, target_column,
        relationship_type, cardinality, optionality, business_reason, technical_reason, audit_usage, analysis_usage, decision_usage,
        enforcement_strategy, delete_policy, source_document, confidence_level, review_status, _created_at, _updated_at
      ) VALUES (
        :sourceId, :targetId, 'public', :sourceTable, :sourceColumn, COALESCE(:targetSchema, 'public'), :targetTable, :targetColumn,
        'FOREIGN_KEY', 'N:1', 'REQUIRED_WHEN_FLOW_REACHES_STEP', :businessReason, :technicalReason, :auditUsage, :analysisUsage, :decisionUsage,
        'DATABASE_FOREIGN_KEY', 'RESTRICT_OR_SOFT_DELETE', 'information_schema_fk', 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
      ) ON CONFLICT (source_schema, source_table, COALESCE(source_column, ''), target_schema, target_table, COALESCE(target_column, ''), relationship_type) DO UPDATE SET
        business_reason = EXCLUDED.business_reason,
        technical_reason = EXCLUDED.technical_reason,
        audit_usage = EXCLUDED.audit_usage,
        analysis_usage = EXCLUDED.analysis_usage,
        decision_usage = EXCLUDED.decision_usage,
        _updated_at = EXCLUDED._updated_at;`,
      {
        replacements: {
          sourceId: sourceEntity[0]?._id ?? null,
          targetId: targetEntity[0]?._id ?? null,
          sourceTable: row.table_name,
          sourceColumn: row.column_name,
          targetSchema: row.referenced_schema,
          targetTable: row.referenced_table,
          targetColumn: row.referenced_column,
          businessReason: `${humanize(row.table_name)} depende de ${humanize(row.referenced_table ?? 'unknown')} para conectar el flujo de información. Esta relación evita registros huérfanos y permite explicar qué entidad originó o soportó el dato.`,
          technicalReason: `La columna ${row.table_name}.${row.column_name} referencia ${row.referenced_table ?? 'unknown'}.${row.referenced_column ?? 'unknown'}. Debe indexarse y respetarse en escrituras transaccionales o validarse de forma lógica en eventos masivos.`,
          auditUsage: `Permite reconstruir la cadena de evidencia entre ${row.table_name} y ${row.referenced_table ?? 'unknown'} durante auditorías de decisión, privacidad o soporte.`,
          analysisUsage: `Permite hacer joins seguros para cohortes, funnels, segmentación de riesgo y monitoreo operativo sin inferir relaciones manualmente.`,
          decisionUsage: `Las decisiones pueden usar esta relación para llegar desde el caso operativo hasta cliente, sesión, dispositivo, consentimiento, feature o resultado de riesgo.`,
          createdAt: CREATED_AT,
        },
      },
    );
  }
}

async function seedLogicalRelationships(queryInterface: QueryInterface) {
  for (const rel of LOGICAL_RELATIONSHIP_METADATA) {
    const sourceEntity = await queryInterface.sequelize.query<{ _id: string }>(
      `SELECT _id FROM system_data_entity_catalog WHERE table_name = :tableName LIMIT 1`,
      { replacements: { tableName: rel.sourceTable }, type: QueryTypes.SELECT },
    );
    const targetEntity = await queryInterface.sequelize.query<{ _id: string }>(
      `SELECT _id FROM system_data_entity_catalog WHERE table_name = :tableName LIMIT 1`,
      { replacements: { tableName: rel.targetTable }, type: QueryTypes.SELECT },
    );
    await queryInterface.sequelize.query(
      `INSERT INTO system_data_relationship_catalog (
        source_data_entity_id, target_data_entity_id, source_schema, source_table, source_column, target_schema, target_table, target_column,
        relationship_type, cardinality, optionality, business_reason, technical_reason, audit_usage, analysis_usage, decision_usage,
        enforcement_strategy, delete_policy, source_document, confidence_level, review_status, _created_at, _updated_at
      ) VALUES (
        :sourceId, :targetId, 'public', :sourceTable, null, 'public', :targetTable, null,
        :relationshipType, :cardinality, :optionality, :businessReason, :technicalReason, :auditUsage, :analysisUsage, :decisionUsage,
        'LOGICAL_RELATION_WITH_SERVICE_VALIDATION', 'SOFT_DELETE_OR_APPEND_ONLY_HISTORY', 'schema_v5_2_logical_relationships', 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
      ) ON CONFLICT (source_schema, source_table, COALESCE(source_column, ''), target_schema, target_table, COALESCE(target_column, ''), relationship_type) DO UPDATE SET
        source_data_entity_id = EXCLUDED.source_data_entity_id,
        target_data_entity_id = EXCLUDED.target_data_entity_id,
        cardinality = EXCLUDED.cardinality,
        optionality = EXCLUDED.optionality,
        business_reason = EXCLUDED.business_reason,
        technical_reason = EXCLUDED.technical_reason,
        audit_usage = EXCLUDED.audit_usage,
        analysis_usage = EXCLUDED.analysis_usage,
        decision_usage = EXCLUDED.decision_usage,
        enforcement_strategy = EXCLUDED.enforcement_strategy,
        delete_policy = EXCLUDED.delete_policy,
        source_document = EXCLUDED.source_document,
        _updated_at = EXCLUDED._updated_at;`,
      {
        replacements: {
          sourceId: sourceEntity[0]?._id ?? null,
          targetId: targetEntity[0]?._id ?? null,
          sourceTable: rel.sourceTable,
          targetTable: rel.targetTable,
          relationshipType: rel.relationshipType,
          cardinality: rel.cardinality ?? '1:N',
          optionality: rel.optionality ?? 'REQUIRED_WHEN_FLOW_REACHES_STEP',
          businessReason: rel.businessReason,
          technicalReason: rel.technicalReason,
          auditUsage: rel.auditUsage,
          analysisUsage: rel.analysisUsage,
          decisionUsage: rel.decisionUsage,
          createdAt: CREATED_AT,
        },
      },
    );
  }
}

async function seedOperationalRules(queryInterface: QueryInterface) {
  const tables = await queryInterface.sequelize.query<{
    table_name: string;
    domain_code: string | null;
    contains_pii: boolean;
    contains_risk_data: boolean;
    contains_device_data: boolean;
    is_audit_critical: boolean;
  }>(
    `SELECT table_name, domain_code, contains_pii, contains_risk_data, contains_device_data, is_audit_critical FROM system_data_entity_catalog WHERE status = 'ACTIVE'`,
    { type: QueryTypes.SELECT },
  );
  for (const table of tables) {
    const rules = [
      {
        type: 'AUDIT',
        severity: table.is_audit_critical ? 'HIGH' : 'MEDIUM',
        name: 'Trazabilidad obligatoria',
        description: 'Toda escritura relevante debe poder conectarse con endpoint, actor, request_id y fecha.',
        layer: 'INTERCEPTOR_SERVICE_DB',
        action: 'Registrar system_action_logs y, cuando aplique, data_change_logs.',
      },
      {
        type: 'QUALITY',
        severity: 'MEDIUM',
        name: 'Calidad mínima de campos',
        description: 'Los campos requeridos, FKs y estados deben validarse antes de persistir.',
        layer: 'ZOD_SERVICE_DATABASE',
        action: 'Rechazar payloads inválidos y crear data_quality_issues si se detecta inconsistencia.',
      },
    ];
    if (table.contains_pii)
      rules.push({
        type: 'PRIVACY',
        severity: 'CRITICAL',
        name: 'Privacidad por diseño',
        description: 'No guardar PII cruda cuando exista estrategia hash/cifrado/redacción.',
        layer: 'SERVICE_CRYPTO_REPOSITORY',
        action: 'Aplicar hash/cifrado/masking y verificar consentimiento o base legal.',
      });
    if (table.contains_risk_data || table.contains_device_data)
      rules.push({
        type: 'RISK',
        severity: 'HIGH',
        name: 'Explicabilidad de riesgo',
        description: 'Todo dato usado por reglas/modelos debe conservar versión, fuente y ventana temporal.',
        layer: 'SERVICE_FEATURE_STORE',
        action: 'Guardar linaje, feature snapshot o regla disparada.',
      });
    for (const rule of rules) {
      const code = `${table.table_name}_${rule.type}_${rule.name}`
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .slice(0, 180);
      await queryInterface.sequelize.query(
        `INSERT INTO system_operational_rule_catalog (
          rule_code, scope_type, schema_name, table_name, domain_code, rule_type, rule_name, description,
          business_reason, technical_enforcement, enforcement_layer, severity, expected_action, audit_evidence,
          analysis_value, is_active, source_document, confidence_level, review_status, _created_at, _updated_at
        ) VALUES (
          :code, 'TABLE', 'public', :tableName, :domainCode, :ruleType, :ruleName, :description,
          :businessReason, :technicalEnforcement, :layer, :severity, :expectedAction, :auditEvidence,
          :analysisValue, true, 'rich_metadata_seed', 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
        ) ON CONFLICT (rule_code) DO UPDATE SET
          description = EXCLUDED.description,
          business_reason = EXCLUDED.business_reason,
          technical_enforcement = EXCLUDED.technical_enforcement,
          expected_action = EXCLUDED.expected_action,
          audit_evidence = EXCLUDED.audit_evidence,
          analysis_value = EXCLUDED.analysis_value,
          _updated_at = EXCLUDED._updated_at;`,
        {
          replacements: {
            code,
            tableName: table.table_name,
            domainCode: table.domain_code,
            ruleType: rule.type,
            ruleName: rule.name,
            description: rule.description,
            businessReason: `La tabla ${table.table_name} existe para un proceso crítico del dominio ${table.domain_code ?? 'PLATAFORMA'}; sin esta regla el dato pierde valor para auditoría, análisis o decisión.`,
            technicalEnforcement: `Aplicar en ${rule.layer}; revisar también constraints SQL, DTOs Zod y servicios de dominio.`,
            layer: rule.layer,
            severity: rule.severity,
            expectedAction: rule.action,
            auditEvidence:
              'Debe quedar evidencia en system_action_logs, data_change_logs, eventos append-only o issues de calidad según corresponda.',
            analysisValue:
              'La regla permite detectar desvíos operativos, deuda técnica, datos incompletos y riesgos de cumplimiento antes de escalar el sistema.',
            createdAt: CREATED_AT,
          },
        },
      );
    }
  }
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

async function tableFieldNames(queryInterface: QueryInterface, tableName: string): Promise<Set<string>> {
  const rows = await queryInterface.sequelize.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :tableName`,
    { replacements: { tableName }, type: QueryTypes.SELECT },
  );
  return new Set(rows.map((row) => row.column_name));
}

async function seedEndpointFieldImpact(
  queryInterface: QueryInterface,
  input: {
    endpointId: string;
    entityId: string;
    tableName: string;
    fieldName: string;
    operation: 'READ' | 'WRITE' | 'COMPUTE' | 'MASK' | 'VALIDATE' | 'HASH' | 'ENCRYPT';
    isRequiredInput: boolean;
    isGenerated: boolean;
    dataSourceKind: string;
    payloadPath: string | null;
    backendWriteReason: string | null;
    notes: string;
  },
): Promise<void> {
  const pii = containsPii(input.tableName, input.fieldName);
  const ml = isMlCandidate(input.tableName, input.fieldName);
  await queryInterface.sequelize.query(
    `INSERT INTO system_endpoint_field_impacts (
      endpoint_id, data_entity_id, field_name, field_operation, is_required_input, is_generated,
      is_sensitive, is_ml_candidate, ml_feature_group, data_source_kind, payload_path, backend_write_reason,
      business_meaning, audit_usage, validation_rule, notes, confidence_level, review_status, _created_at, _updated_at
    ) VALUES (
      :endpointId, :entityId, :fieldName, :operation, :isRequiredInput, :isGenerated,
      :isSensitive, :isMlCandidate, :mlFeatureGroup, :dataSourceKind, :payloadPath, :backendWriteReason,
      :businessMeaning, :auditUsage, CAST(:validationRule AS jsonb), :notes, 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
    ) ON CONFLICT (endpoint_id, data_entity_id, field_name, field_operation) DO UPDATE SET
      is_required_input = EXCLUDED.is_required_input,
      is_generated = EXCLUDED.is_generated,
      is_sensitive = EXCLUDED.is_sensitive,
      is_ml_candidate = EXCLUDED.is_ml_candidate,
      ml_feature_group = EXCLUDED.ml_feature_group,
      data_source_kind = EXCLUDED.data_source_kind,
      payload_path = EXCLUDED.payload_path,
      backend_write_reason = EXCLUDED.backend_write_reason,
      business_meaning = EXCLUDED.business_meaning,
      audit_usage = EXCLUDED.audit_usage,
      validation_rule = EXCLUDED.validation_rule,
      notes = EXCLUDED.notes,
      confidence_level = EXCLUDED.confidence_level,
      review_status = EXCLUDED.review_status,
      _updated_at = EXCLUDED._updated_at;`,
    {
      replacements: {
        endpointId: input.endpointId,
        entityId: input.entityId,
        fieldName: input.fieldName,
        operation: input.operation,
        isRequiredInput: input.isRequiredInput,
        isGenerated: input.isGenerated,
        isSensitive: pii,
        isMlCandidate: ml,
        mlFeatureGroup: mlGroup(input.tableName, input.fieldName),
        dataSourceKind: input.dataSourceKind,
        payloadPath: input.payloadPath,
        backendWriteReason: input.backendWriteReason,
        businessMeaning: fieldBusinessMeaning(input.tableName, input.fieldName),
        auditUsage: input.isGenerated
          ? `Auditoría verifica que ${input.tableName}.${input.fieldName} fue generado por backend y no manipulado desde cliente.`
          : `Auditoría compara ${input.tableName}.${input.fieldName} contra payload, DTO, actor y request para explicar la escritura o lectura.`,
        validationRule: JSON.stringify({
          source: input.dataSourceKind,
          operation: input.operation,
          requiredInput: input.isRequiredInput,
          sensitive: pii,
          expectedControl: input.isGenerated ? 'no aceptar desde payload' : 'validar con DTO/Zod y reglas de negocio',
        }),
        notes: input.notes,
        createdAt: CREATED_AT,
      },
    },
  );
}

async function seedEndpointFieldImpacts(
  queryInterface: QueryInterface,
  endpointId: string,
  entityId: string,
  tableName: string,
  kind: 'READ' | 'INSERT' | 'UPDATE' | 'SOFT_DELETE',
  payloadFields: string[],
): Promise<void> {
  const columns = await tableFieldNames(queryInterface, tableName);
  const normalizedPayloadFields = [...new Set(payloadFields.map((field) => toSnakeCase(field)).filter(Boolean))];
  const matchedPayloadFields = normalizedPayloadFields.filter((field) => columns.has(field));
  const payloadFieldsToStore = matchedPayloadFields.length > 0 ? matchedPayloadFields : normalizedPayloadFields.slice(0, 12);

  if (kind === 'READ') {
    for (const fieldName of ['_id', 'status', '_created_at', ...payloadFieldsToStore].filter(
      (field) => columns.has(field) || payloadFieldsToStore.includes(field),
    )) {
      await seedEndpointFieldImpact(queryInterface, {
        endpointId,
        entityId,
        tableName,
        fieldName,
        operation: payloadFieldsToStore.includes(fieldName) ? 'VALIDATE' : 'READ',
        isRequiredInput: payloadFieldsToStore.includes(fieldName),
        isGenerated: false,
        dataSourceKind: payloadFieldsToStore.includes(fieldName) ? 'QUERY_PARAM' : 'DATABASE_READ',
        payloadPath: payloadFieldsToStore.includes(fieldName) ? fieldName : null,
        backendWriteReason: null,
        notes: payloadFieldsToStore.includes(fieldName)
          ? `El endpoint valida ${fieldName} desde query/path antes de leer ${tableName}.`
          : `El endpoint puede leer ${tableName}.${fieldName} para responder o filtrar información.`,
      });
    }
    return;
  }

  for (const fieldName of payloadFieldsToStore) {
    await seedEndpointFieldImpact(queryInterface, {
      endpointId,
      entityId,
      tableName,
      fieldName,
      operation: 'WRITE',
      isRequiredInput: true,
      isGenerated: false,
      dataSourceKind: 'PAYLOAD',
      payloadPath: `$.body.${fieldName}`,
      backendWriteReason:
        'Campo recibido desde el cliente, validado por DTO/Zod y persistido o usado para detonar una escritura de dominio.',
      notes: `El endpoint toma ${fieldName} desde payload/query/path y lo conecta con ${tableName}.`,
    });
  }

  for (const fieldName of ['_id', '_created_at', '_updated_at', 'status', 'request_id', 'idempotency_key'].filter((field) =>
    columns.has(field),
  )) {
    await seedEndpointFieldImpact(queryInterface, {
      endpointId,
      entityId,
      tableName,
      fieldName,
      operation: fieldName.includes('status') ? 'COMPUTE' : 'WRITE',
      isRequiredInput: false,
      isGenerated: true,
      dataSourceKind: fieldName.endsWith('_at') ? 'SYSTEM_CLOCK' : 'BACKEND_GENERATED',
      payloadPath: null,
      backendWriteReason: `${fieldName} se genera en backend para identidad técnica, trazabilidad, idempotencia, estado o fecha de auditoría; no debe venir confiado desde el cliente.`,
      notes: `Campo detonado/escrito por backend durante ${kind} sobre ${tableName}.`,
    });
  }
}

async function seedEndpointImpacts(queryInterface: QueryInterface, endpoint: EndpointScan) {
  const endpointRows = await queryInterface.sequelize.query<{ _id: string; code: string }>(
    `SELECT _id, code FROM system_endpoint_catalog WHERE method = :method AND full_path = :fullPath LIMIT 1`,
    { replacements: { method: endpoint.method, fullPath: endpoint.fullPath }, type: QueryTypes.SELECT },
  );
  const endpointId = endpointRows[0]?._id;
  if (!endpointId) return;
  const impact = impactedTablesFor(endpoint);
  const payloadFields = [
    ...(endpoint.bodySchema?.required ?? []),
    ...(endpoint.bodySchema?.optional ?? []),
    ...(endpoint.querySchema?.required ?? []),
    ...(endpoint.querySchema?.optional ?? []),
    ...(endpoint.paramSchema?.required ?? []),
    ...(endpoint.paramSchema?.optional ?? []),
  ];
  for (const [kind, tables] of [
    ['READ', impact.reads],
    [endpoint.method === 'PATCH' ? 'UPDATE' : endpoint.method === 'DELETE' ? 'SOFT_DELETE' : 'INSERT', impact.writes],
  ] as const) {
    for (const [index, tableName] of tables.entries()) {
      const entity = await queryInterface.sequelize.query<{ _id: string }>(
        `SELECT _id FROM system_data_entity_catalog WHERE table_name = :tableName LIMIT 1`,
        { replacements: { tableName }, type: QueryTypes.SELECT },
      );
      if (!entity[0]) continue;
      const generatedFields = kind === 'READ' ? [] : ['_id', '_created_at', '_updated_at', 'status'].filter(Boolean);
      await queryInterface.sequelize.query(
        `INSERT INTO system_endpoint_data_entity_impacts (
          endpoint_id, data_entity_id, operation_type, impact_level, is_primary_entity, is_transactional, rollback_required,
          affects_customer_state, affects_financial_state, affects_risk_state, affects_legal_state, affects_device_state,
          affects_notification_state, requires_audit_log, requires_regression_test, requires_stress_test, notes,
          impact_reason, impacted_fields_summary, payload_fields_json, backend_generated_fields_json, read_fields_json, write_fields_json,
          detected_from, confidence_level, review_status, _created_at, _updated_at
        ) VALUES (
          :endpointId, :entityId, :operationType, :impactLevel, :isPrimary, :isTransactional, :rollbackRequired,
          :affectsCustomer, :affectsFinancial, :affectsRisk, :affectsLegal, :affectsDevice,
          :affectsNotification, true, :requiresRegression, :requiresStress, :notes,
          :impactReason, :fieldsSummary, CAST(:payloadFields AS jsonb), CAST(:generatedFields AS jsonb), CAST(:readFields AS jsonb), CAST(:writeFields AS jsonb),
          'rich_metadata_seed', 'HIGH', 'AUTO_DETECTED', :createdAt, :createdAt
        ) ON CONFLICT (endpoint_id, data_entity_id, operation_type) DO UPDATE SET
          impact_level = EXCLUDED.impact_level,
          impact_reason = EXCLUDED.impact_reason,
          impacted_fields_summary = EXCLUDED.impacted_fields_summary,
          payload_fields_json = EXCLUDED.payload_fields_json,
          backend_generated_fields_json = EXCLUDED.backend_generated_fields_json,
          read_fields_json = EXCLUDED.read_fields_json,
          write_fields_json = EXCLUDED.write_fields_json,
          notes = EXCLUDED.notes,
          confidence_level = EXCLUDED.confidence_level,
          review_status = EXCLUDED.review_status,
          _updated_at = EXCLUDED._updated_at;`,
        {
          replacements: {
            endpointId,
            entityId: entity[0]._id,
            operationType: kind,
            impactLevel: endpointRisk(endpoint) === 'CRITICAL' ? 'CRITICAL' : kind === 'READ' ? 'MEDIUM' : 'HIGH',
            isPrimary: index === 0,
            isTransactional: kind !== 'READ',
            rollbackRequired: kind !== 'READ',
            affectsCustomer: /customer|identity|contact|address|consent/.test(tableName),
            affectsFinancial: /payment|credit|amount|value|limit|feature/.test(tableName),
            affectsRisk: /risk|fraud|feature|observation|watchlist|device/.test(tableName),
            affectsLegal: /consent|privacy|retention|classification|sensitive/.test(tableName),
            affectsDevice: /device|session|sim|ip_reputation/.test(tableName),
            affectsNotification: /notification|outbox/.test(tableName),
            requiresRegression: kind !== 'READ',
            requiresStress: endpointRisk(endpoint) !== 'LOW',
            notes: `${endpoint.method} ${endpoint.fullPath} ${kind === 'READ' ? 'lee' : 'escribe o detona escritura en'} ${tableName}.`,
            impactReason: `Este endpoint impacta ${tableName} porque el flujo ${endpointPurpose(endpoint).toLowerCase()} necesita ${kind === 'READ' ? 'consultar estado previo, permisos, catálogos o evidencia' : 'persistir estado, evento, evidencia o resultado generado por backend'}.`,
            fieldsSummary:
              kind === 'READ'
                ? 'Campos leídos según filtros/relaciones del servicio; revisar field catalog para detalle.'
                : `Payload estimado: ${payloadFields.join(', ') || 'sin body explícito'}; backend genera ids, timestamps, hashes, estados y relaciones.`,
            payloadFields: JSON.stringify(payloadFields),
            generatedFields: JSON.stringify(generatedFields),
            readFields: JSON.stringify(kind === 'READ' ? ['_id', 'status', '_created_at'] : []),
            writeFields: JSON.stringify(kind === 'READ' ? [] : generatedFields),
            createdAt: CREATED_AT,
          },
        },
      );
      await seedEndpointFieldImpacts(queryInterface, endpointId, entity[0]._id, tableName, kind, payloadFields);
    }
  }
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  for (const domain of DOMAIN_BUSINESS_METADATA) await upsertDomain(queryInterface, domain);
  await seedColumns(queryInterface);
  await seedRelationships(queryInterface);
  await seedLogicalRelationships(queryInterface);
  await seedOperationalRules(queryInterface);

  const endpoints = scanControllers();
  for (const endpoint of endpoints) {
    await upsertEndpoint(queryInterface, endpoint);
    await upsertPayloadContract(queryInterface, endpoint, 'BODY', endpoint.bodySchema);
    await upsertPayloadContract(queryInterface, endpoint, 'QUERY', endpoint.querySchema);
    await upsertPayloadContract(queryInterface, endpoint, 'PATH', endpoint.paramSchema);
    await seedEndpointImpacts(queryInterface, endpoint);
  }
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.sequelize.query(`DELETE FROM system_endpoint_payload_contracts WHERE source_file IS NOT NULL;`);
  await queryInterface.sequelize.query(`DELETE FROM system_operational_rule_catalog WHERE source_document = 'rich_metadata_seed';`);
  await queryInterface.sequelize.query(
    `DELETE FROM system_data_relationship_catalog WHERE source_document IN ('information_schema_fk','schema_v5_2_logical_relationships');`,
  );
  await queryInterface.sequelize.query(
    `DELETE FROM system_data_field_catalog WHERE source_document = 'information_schema+schema_v5_2_pdf';`,
  );
  await queryInterface.sequelize.query(`DELETE FROM system_domain_catalog WHERE domain_code IN (:codes);`, {
    replacements: { codes: DOMAIN_BUSINESS_METADATA.map((domain) => domain.domainCode) },
  });
}
