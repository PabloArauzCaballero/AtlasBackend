/**
 * Gate estático: cada proceso declarado en código contesta las cinco preguntas y dice quién es su dueño.
 *
 * Un proceso sin narrativa se ve igual en el portal que uno documentado: una ficha con etapas. Lo que
 * falta —por qué existe, qué pasa si falla— es justo lo que nadie puede deducir del código, y es la
 * razón de tener el catálogo. Este gate hace ruidosa esa ausencia en el PR que la introduce.
 *
 * Ejecutar con `yarn check:process-narratives`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasSchemaFor } from '../../src/database/domain-schemas.js';
import { ATLAS_DOMAIN_TABLES } from '../../src/database/domain-tables.js';
import { INTERNAL_ROLE_CODES } from '../../src/modules/internal-users/internal-rbac.roles.js';
import {
  PROCESS_ACTOR_TYPES,
  PROCESS_CLIENT_CODES,
  PROCESS_PRIORITIES,
  PROCESS_SYSTEM_CODES,
  type ProcessNarrative,
} from '../../src/modules/workflow-catalog/definitions/workflow-definition.types.js';
import { clientScreens, FIXTURES, finish, normalizeRoute } from './process-catalog.lib.js';

const MIN = 80;
const QUESTIONS: Array<keyof ProcessNarrative> = ['whyExists', 'whoStartsAndCloses', 'startAndEnd', 'whenItFails', 'healthIndicator'];
const PERSON_ACTORS = new Set(['customer', 'internal_user', 'merchant_user', 'platform_user']);
const PERSON_CLIENTS = new Set(['ADMIN_PORTAL', 'ERP_PORTAL', 'MOTOR_PORTAL', 'DASHBOARDS_PORTAL']);
const ALL_TABLES = new Set(Object.values(ATLAS_DOMAIN_TABLES).flat());
/** Jerga que no va en el texto de negocio que lee un tester (revisión de `ux-writing-microcopy`). */
const JARGON = /\b(backend|endpoint)\b/i;

/** Columnas por tabla, leídas de los `@Column({ field: '…' })` de los modelos (sin cargar Sequelize). */
const MODEL_COLUMNS = new Map<string, Set<string>>();
for (const file of readdirSync(join(process.cwd(), 'src/database/models')).filter((n) => n.endsWith('.model.ts'))) {
  const source = readFileSync(join(process.cwd(), 'src/database/models', file), 'utf8');
  const table = /tableName:\s*'([^']+)'/.exec(source)?.[1];
  if (table) MODEL_COLUMNS.set(table, new Set([...source.matchAll(/field:\s*'([^']+)'/g)].map((m) => m[1]!)));
}

const SCREENS = clientScreens();
const errors: string[] = [];
const warnings: string[] = [];
const codes = new Set<string>();
const ids = new Set<string>();

for (const f of FIXTURES) {
  const at = `${f.processId} ${f.code}`;
  if (codes.has(f.code)) errors.push(`${at}: código repetido`);
  codes.add(f.code);
  if (ids.has(f.processId)) errors.push(`${at}: id de inventario repetido`);
  ids.add(f.processId);
  if (!/^[PC]-\d{2}$/.test(f.processId)) errors.push(`${at}: processId debe ser P-nn (inventario) o C-nn (recorrido compuesto)`);
  if (!/^[a-z][a-z0-9_]+$/.test(f.code)) errors.push(`${at}: code no es snake_case`);
  if (!(PROCESS_PRIORITIES as readonly string[]).includes(f.priority)) errors.push(`${at}: prioridad ${f.priority}`);
  const roleOk = (INTERNAL_ROLE_CODES as readonly string[]).includes(f.ownerRole) || /^(ERP|MOTOR):[A-Z_]+$/.test(f.ownerRole);
  if (!roleOk) errors.push(`${at}: ownerRole ${f.ownerRole} no es un rol interno ni ERP:/MOTOR:`);
  if (!f.systems.length || f.systems.some((s) => !(PROCESS_SYSTEM_CODES as readonly string[]).includes(s)))
    errors.push(`${at}: systems inválido`);
  if (!f.sources.length) errors.push(`${at}: sin fuentes; la narrativa tiene que salir de algún sitio`);
  for (const q of QUESTIONS) {
    const text = f.narrative?.[q] ?? '';
    if (text.trim().length < MIN) errors.push(`${at}: narrativa.${q} tiene ${text.trim().length} caracteres (mínimo ${MIN})`);
    if (JARGON.test(text)) warnings.push(`${at}: narrativa.${q} usa jerga técnica («backend»/«endpoint»)`);
  }
  if (f.instanceEntity?.system === 'ATLAS_BACKEND') {
    const { table, schema } = f.instanceEntity;
    if (!ALL_TABLES.has(table)) errors.push(`${at}: instanceEntity.table ${table} no está en ATLAS_DOMAIN_TABLES`);
    else if (atlasSchemaFor(table) !== schema)
      errors.push(`${at}: instanceEntity.schema ${schema} no es el de ${table} (${atlasSchemaFor(table)})`);
    const columns = MODEL_COLUMNS.get(table);
    for (const col of [f.instanceEntity.idColumn, f.instanceEntity.statusColumn, f.instanceEntity.labelColumn].filter(
      Boolean,
    ) as string[]) {
      if (columns && !columns.has(col)) errors.push(`${at}: instanceEntity.${col} no es una columna de ${table}`);
    }
  }
  if (!f.stages.length) errors.push(`${at}: sin etapas`);
  const stageCodes = new Set(f.stages.map((s) => s.code));
  for (const s of f.stages) {
    if (!s.name?.trim() || !s.description?.trim() || !s.module?.trim())
      errors.push(`${at}/${s.code}: etapa sin nombre, descripción o módulo`);
    if (!(PROCESS_ACTOR_TYPES as readonly string[]).includes(s.actor)) errors.push(`${at}/${s.code}: actor ${s.actor}`);
    if (!(PROCESS_CLIENT_CODES as readonly string[]).includes(s.client)) errors.push(`${at}/${s.code}: cliente ${s.client}`);
    if (s.parent && !stageCodes.has(s.parent)) errors.push(`${at}/${s.code}: etapa madre ${s.parent} no existe`);
    // Una pantalla declarada que su portal no tiene manda a una persona a una ruta vacía. Es aviso y no
    // error porque una pantalla recién hecha en una rama abierta aún no está en la copia de Flujos.
    if (s.screen && SCREENS.get(s.client)?.size) {
      const route = normalizeRoute(s.screen.split('?')[0]!.replace(/\[([^\]]+)\]/g, ':$1'));
      if (!SCREENS.get(s.client)!.has(route))
        warnings.push(`${at}/${s.code}: la pantalla ${s.screen} no está entre las de ${s.client} según Flujos`);
    }
    // Una persona sin pantalla es un hueco de cableado: se avisa (lo mide PROCESS_STEP_UNWIRED), no se bloquea.
    if (PERSON_ACTORS.has(s.actor) && PERSON_CLIENTS.has(s.client) && !s.screen && !s.link)
      warnings.push(`${at}/${s.code}: actúa una persona en ${s.client} y no se declara pantalla`);
  }
}

finish('check:process-narratives', errors, warnings, FIXTURES.length);
