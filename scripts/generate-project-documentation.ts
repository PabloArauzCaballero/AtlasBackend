/**
 * Genera la documentación navegable por carpeta y cabeceras JSDoc de archivo.
 *
 * La documentación se deriva de la estructura real para que el inventario no quede obsoleto. Los
 * README escritos a mano nunca se reemplazan; solo se actualizan los que contienen GENERATED_MARKER.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

type Context = { business: string; system: string };

const ROOTS = ['.github', 'config', 'docs', 'ops', 'scripts', 'src', 'test'];
const GENERATED_MARKER = '<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->';
// `site` y `__pycache__` son salida de `mkdocs build` y del intérprete de Python: documentarlas
// produce README dentro de artefactos regenerables que nadie va a leer ni a mantener.
const IGNORED_PARTS = new Set(['node_modules', 'dist', 'coverage', 'graphify-out', 'logs', 'results', 'site', '__pycache__']);

const MODULES: Record<string, Context> = {
  audit: {
    business: 'aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte',
    system: 'consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte',
  },
  auth: {
    business: 'protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones',
    system: 'resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens',
  },
  'catalog-management': {
    business: 'gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes',
    system: 'implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos',
  },
  consents: {
    business: 'demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal',
    system: 'registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia',
  },
  credit: {
    business: 'materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables',
    system: 'coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito',
  },
  'customer-onboarding': {
    business: 'convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera',
    system: 'orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo',
  },
  'customer-privacy': {
    business: 'hace exigibles los derechos de privacidad y limita el uso de datos personales',
    system: 'gestiona decisiones de tratamiento y solicitudes del titular con auditoría y aislamiento por tenant',
  },
  customers: {
    business: 'mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad',
    system: 'expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas',
  },
  'customer-telemetry': {
    business: 'captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión',
    system: 'valida e ingiere lotes de telemetría con límites, redacción y escritura transaccional',
  },
  'data-quality': {
    business: 'evita decisiones crediticias basadas en datos incompletos, incoherentes o sin linaje',
    system: 'administra reglas, ejecuciones y hallazgos de calidad consultables por operaciones',
  },
  events: {
    business: 'desacopla procesos de negocio y permite reintentos auditables sin perder eventos',
    system: 'registra definiciones, outbox y procesamiento idempotente de eventos de dominio',
  },
  'external-data': {
    business: 'incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad',
    system: 'aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia',
  },
  fraud: {
    business: 'reduce pérdidas y habilita revisión humana explicable de señales sospechosas',
    system: 'administra casos, decisiones y eventos de fraude dentro de transacciones auditables',
  },
  health: {
    business: 'permite retirar instancias enfermas antes de afectar a clientes u operadores',
    system: 'expone liveness y readiness con estados HTTP útiles para orquestadores',
  },
  'internal-portal': {
    business: 'ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles',
    system: 'compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo',
  },
  'internal-users': {
    business: 'controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios',
    system: 'implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular',
  },
  'log-sync': {
    business: 'preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada',
    system: 'sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas',
  },
  'mail-sender': {
    business: 'entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso',
    system: 'encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados',
  },
  notifications: {
    business: 'entrega mensajes oportunos y respetuosos de preferencias por canales configurables',
    system: 'orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes',
  },
  operations: {
    business: 'permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad',
    system: 'gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados',
  },
  risk: {
    business: 'produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente',
    system: 'calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado',
  },
  'runtime-hardening': {
    business: 'evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales',
    system: 'centraliza idempotencia y outbox como garantías transversales del runtime HTTP',
  },
  'runtime-jobs': {
    business: 'completa trabajo asíncrono y recuperable fuera de la latencia del request',
    system: 'reclama, procesa y reintenta jobs/outbox con locks y métricas operativas',
  },
  'schema-management': {
    business: 'gobierna propuestas de estructura sin permitir DDL directo desde el portal',
    system: 'valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas',
  },
  sessions: {
    business: 'mantiene continuidad, seguridad y señales de uso durante la interacción del cliente',
    system: 'orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión',
  },
  'systems-ops': {
    business: 'hace observable y gobernable el propio backend para operaciones, QA y arquitectura',
    system: 'descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura',
  },
  'workflow-catalog': {
    business: 'publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica',
    system: 'expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones',
  },
};

function normalized(path: string): string {
  return path.split(sep).join('/');
}

function moduleContext(path: string): Context | undefined {
  const parts = normalized(path).split('/');
  const modulesIndex = parts.indexOf('modules');
  const testIndex = parts.findIndex((part) => part === 'unit' || part === 'e2e');
  return MODULES[parts[modulesIndex + 1] ?? ''] ?? MODULES[parts[testIndex + 1] ?? ''];
}

function contextFor(path: string): Context {
  const pathKey = normalized(path);
  const module = moduleContext(path);
  if (pathKey.startsWith('test/'))
    return {
      business: module
        ? `previene regresiones en una capacidad que ${module.business}`
        : 'previene regresiones que afectarían los contratos críticos del backend',
      system: `contiene pruebas ${pathKey.includes('/e2e') || pathKey.startsWith('test/e2e') ? 'HTTP integradas' : 'unitarias'} y soporte reproducible; ${module?.system ?? 'valida componentes aislados'}`,
    };
  if (module) return module;
  if (pathKey.startsWith('src/common/'))
    return {
      business: 'aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos',
      system: `provee infraestructura transversal de ${basename(pathKey)} sin introducir reglas de un dominio específico`,
    };
  if (pathKey === 'src' || pathKey === 'src/modules')
    return {
      business: 'implementa las capacidades operativas, de identidad, riesgo y crédito de Atlas',
      system: 'organiza el runtime NestJS en módulos con límites explícitos y dependencias dirigidas',
    };
  if (pathKey.startsWith('src/database'))
    return {
      business: 'preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento',
      system: `define ${basename(pathKey)} para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada`,
    };
  if (pathKey.startsWith('src/config'))
    return { business: 'evita operar con parámetros inseguros o ambiguos', system: 'valida y compone configuración tipada al arrancar' };
  if (pathKey.startsWith('src/observability'))
    return {
      business: 'reduce el tiempo de detección y recuperación de incidentes',
      system: 'inicializa trazas y telemetría antes del runtime',
    };
  if (pathKey.startsWith('scripts'))
    return {
      business: 'convierte operaciones delicadas en procedimientos repetibles y verificables',
      system: 'automatiza gates, desarrollo, migraciones, seeds, smokes y mantenimiento',
    };
  if (pathKey.startsWith('docs'))
    return {
      business: 'conserva decisiones y contratos para reducir dependencia de conocimiento tácito',
      system: `documenta ${basename(pathKey)} como fuente versionada para desarrollo y operación`,
    };
  if (pathKey.startsWith('ops'))
    return {
      business: 'hace desplegable y operable el servicio con controles reproducibles',
      system: 'versiona configuración de base de datos y observabilidad fuera del código de aplicación',
    };
  if (pathKey.startsWith('config'))
    return {
      business: 'mantiene visible el alcance y secuencia de evolución del producto',
      system: 'provee configuración declarativa consumible por herramientas y revisiones',
    };
  if (pathKey.startsWith('.github'))
    return {
      business: 'protege la calidad antes de integrar o desplegar cambios',
      system: 'define automatización de CI, seguridad y políticas del repositorio',
    };
  return { business: 'sostiene una parte mantenida del backend Atlas', system: 'agrupa artefactos relacionados bajo un límite navegable' };
}

function fileRole(name: string): string {
  const rules: Array<[RegExp, string]> = [
    [/\.controller\.ts$/, 'Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.'],
    [/\.service\.ts$/, 'Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.'],
    [/\.repository\.ts$/, 'Puerto de persistencia: encapsula consultas, locks y escrituras.'],
    [/\.model\.ts$/, 'Modelo ORM: mapea una tabla y su contrato tipado.'],
    [/\.schemas\.ts$/, 'Esquemas Zod: validan entradas y parámetros en el borde del sistema.'],
    [/\.dtos\.ts$/, 'DTOs: contrato estable de salida sin filtrar modelos de persistencia.'],
    [/\.mapper\.ts$/, 'Mapper: transforma modelos internos a contratos de transporte.'],
    [/\.module\.ts$/, 'Módulo NestJS: declara el límite de inyección y sus dependencias.'],
    [/\.guard\.ts$/, 'Guard: aplica autenticación o autorización antes del caso de uso.'],
    [/\.decorator\.ts$/, 'Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme.'],
    [/\.interceptor\.ts$/, 'Interceptor: aplica una política transversal al ciclo HTTP.'],
    [/\.filter\.ts$/, 'Filtro: traduce errores a un contrato HTTP controlado.'],
    [/\.pipe\.ts$/, 'Pipe: valida o transforma datos antes de invocar el controlador.'],
    [/\.spec\.ts$/, 'Prueba automatizada: fija comportamiento y evita regresiones.'],
    [/migration|^\d{14}-/, 'Migración reversible: evoluciona el esquema PostgreSQL en orden.'],
    [/seed/, 'Seeder idempotente: instala datos de referencia o fixtures del perfil.'],
    [/\.util\.ts$/, 'Utilidad pura o acotada reutilizable dentro de su capa.'],
    [/\.types?\.ts$/, 'Tipos de dominio: hacen explícitos estados y contratos internos.'],
    [/\.interface\.ts$/, 'Puerto tipado: desacopla un caso de uso de su implementación.'],
    [/\.md$/, 'Documento versionado: explica decisiones, contratos o procedimientos.'],
    [/\.ya?ml$/, 'Configuración declarativa legible y versionada.'],
    [/\.json$/, 'Configuración o contrato serializado consumido por herramientas.'],
    [/\.sql$/, 'Operación PostgreSQL versionada para bootstrap o verificación.'],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? 'Artefacto de soporte específico de esta carpeta.';
}

function directEntries(path: string): { files: string[]; directories: string[] } {
  const entries = readdirSync(path, { withFileTypes: true }).filter((entry) => !IGNORED_PARTS.has(entry.name));
  return {
    files: entries
      .filter((entry) => entry.isFile() && entry.name !== 'README.md')
      .map((entry) => entry.name)
      .sort(),
    directories: entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
  };
}

function readmeFor(path: string): string {
  const relativePath = normalized(relative(process.cwd(), path));
  const context = contextFor(relativePath);
  const entries = directEntries(path);
  const title = relativePath === '' ? 'AtlasBackend' : relativePath;
  const files = entries.files.length
    ? entries.files.map((name) => `| [\`${name}\`](./${encodeURI(name)}) | ${fileRole(name)} |`).join('\n')
    : '| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |';
  const children = entries.directories.length
    ? `\n## Subcarpetas\n\n${entries.directories.map((name) => `- [\`${name}/\`](./${encodeURI(name)}/README.md)`).join('\n')}\n`
    : '';
  return `${GENERATED_MARKER}\n\n# ${title}\n\n## Por qué existe\n\n- **Negocio:** esta carpeta ${context.business}.\n- **Sistema:** esta carpeta ${context.system}.\n\n## Contenido\n\n| Documento o código | Responsabilidad |\n|---|---|\n${files}\n${children}\n## Reglas de mantenimiento\n\n- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.\n- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.\n- Actualizar pruebas y este inventario con \`yarn docs:project\` cuando cambie la estructura.\n`;
}

function walkDirectories(root: string): string[] {
  const result: string[] = [];
  const visit = (path: string): void => {
    result.push(path);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_PARTS.has(entry.name)) visit(join(path, entry.name));
    }
  };
  if (existsSync(root)) visit(root);
  return result;
}

function generateReadmes(): number {
  let changed = 0;
  for (const path of ROOTS.flatMap(walkDirectories)) {
    const readmePath = join(path, 'README.md');
    const existing = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : '';
    if (existing && !existing.includes(GENERATED_MARKER)) continue;
    const next = readmeFor(path);
    if (next !== existing) {
      writeFileSync(readmePath, next, 'utf-8');
      changed += 1;
    }
  }
  return changed;
}

function addInlineHeaders(): number {
  let changed = 0;
  for (const path of walkDirectories('src')) {
    const relativePath = normalized(relative(process.cwd(), path));
    const context = contextFor(relativePath);
    for (const name of readdirSync(path)) {
      const filePath = join(path, name);
      if (!name.endsWith('.ts') || !statSync(filePath).isFile()) continue;
      let source = readFileSync(filePath, 'utf-8');
      if (source.replace(/^\uFEFF/, '').startsWith('/**')) {
        const headerEnd = source.indexOf('*/');
        if (headerEnd >= 0) {
          const header = source
            .slice(0, headerEnd + 2)
            .replace(/^\+ \*/gm, ' *')
            .replace(/^\+ \*\//gm, ' */');
          const repaired = `${header}${source.slice(headerEnd + 2)}`;
          if (repaired !== source) {
            writeFileSync(filePath, repaired, 'utf-8');
            changed += 1;
          }
        }
        continue;
      }
      const header = `/**\n * @file ${fileRole(name)}\n * @business Esta pieza ${context.business}.\n * @system ${context.system}.\n */\n`;
      writeFileSync(filePath, `${header}${source}`, 'utf-8');
      changed += 1;
    }
  }
  return changed;
}

const args = new Set(process.argv.slice(2));
const readmes = args.has('--inline-only') ? 0 : generateReadmes();
const inline = args.has('--readmes-only') ? 0 : addInlineHeaders();
console.log(`Documentación actualizada: README=${readmes}, cabeceras inline=${inline}.`);
