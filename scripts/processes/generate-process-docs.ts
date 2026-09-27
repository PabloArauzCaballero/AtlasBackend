/**
 * Genera `docs/processes/<code>.md` y su índice a partir de las fixtures de procesos.
 *
 * La documentación de procesos se escribía a mano y envejecía: casi todo lo que hay en `docs/` es de
 * julio o agosto. Aquí sale de la misma fuente que la base y el portal, así que no puede discrepar.
 *
 *   yarn docs:processes          → escribe
 *   yarn check:process-docs      → falla si lo commiteado difiere de lo que se generaría
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ProcessStageFixture,
  WorkflowDefinitionFixture,
} from '../../src/modules/workflow-catalog/definitions/workflow-definition.types.js';
import { FIXTURES, ROOT } from './process-catalog.lib.js';

const DIR = join(ROOT, 'docs/processes');
const HEADER =
  '<!-- Generado por scripts/processes/generate-process-docs.ts desde src/modules/workflow-catalog/definitions. No editar a mano. -->';
const QUESTIONS: Array<[keyof WorkflowDefinitionFixture['narrative'], string]> = [
  ['whyExists', 'Por qué existe'],
  ['whoStartsAndCloses', 'Quién lo inicia y quién lo cierra'],
  ['startAndEnd', 'Cuándo empieza y cuándo termina'],
  ['whenItFails', 'Qué pasa cuando falla'],
  ['healthIndicator', 'Qué indicador dice que va bien'],
];
const cell = (v: string | undefined): string => (v ?? '—').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function stageRow(s: ProcessStageFixture): string {
  return `| \`${s.code}\` | ${cell(s.name)} | ${s.actor} | ${s.client} | ${s.screen ? `\`${s.screen}\`` : s.link ? `enlace: \`${s.link}\`` : s.client === 'BLOCK' ? '—' : '**sin pantalla declarada**'} | ${s.steps.length} |`;
}

function mermaid(f: WorkflowDefinitionFixture): string[] {
  const top = f.stages.filter((s) => !s.parent);
  const id = (c: string) => c.replace(/[^A-Za-z0-9_]/g, '_');
  return [
    '```mermaid',
    'flowchart LR',
    ...top.map((s) => `  ${id(s.code)}["${s.name.replace(/"/g, "'")}"]`),
    ...top.slice(1).map((s, i) => `  ${id(top[i]!.code)} --> ${id(s.code)}`),
    '```',
  ];
}

function page(f: WorkflowDefinitionFixture): string {
  const lines = [
    HEADER,
    '',
    `# ${f.processId} · ${f.name}`,
    '',
    `\`${f.code}\` · ${f.version} · prioridad **${f.priority}** · tipo \`${f.processType}\` · dueño \`${f.ownerRole}\` · bloques ${f.systems.map((s) => `\`${s}\``).join(', ')}`,
    '',
    f.description,
    '',
    ...QUESTIONS.flatMap(([k, title]) => [`## ${title}`, '', f.narrative[k], '']),
    '## Resultado',
    '',
    `- **Éxito:** ${f.success}`,
    `- **Fracaso:** ${f.failure}`,
    '',
  ];
  if (f.instanceEntity) {
    const e = f.instanceEntity;
    lines.push(
      '## Dónde vive cada instancia',
      '',
      `\`${e.system}\` · \`${e.schema}.${e.table}\` · estado en \`${e.statusColumn}\`${e.openStatuses?.length ? ` · abiertas: ${e.openStatuses.map((x) => `\`${x}\``).join(', ')}` : ''}`,
      '',
    );
  }
  lines.push(
    '## Etapas',
    '',
    ...mermaid(f),
    '',
    '| Etapa | Nombre | Actor | Cliente | Pantalla | Pasos |',
    '|---|---|---|---|---|---|',
    ...f.stages.map(stageRow),
    '',
  );
  for (const s of f.stages) {
    lines.push(
      `### ${s.name} (\`${s.code}\`)`,
      '',
      s.description,
      '',
      '| Paso | Tipo | Bloque | Operación | Roles | Eventos |',
      '|---|---|---|---|---|---|',
    );
    for (const p of s.steps) {
      const kind = p.kind ?? 'http';
      const op = kind === 'http' ? `\`${p.method} ${p.path}\`` : kind === 'job' ? `job \`${p.job}\`` : cell(p.reason);
      lines.push(
        `| ${cell(p.name)} | ${kind} | ${p.system ?? 'ATLAS_BACKEND'} | ${op} | ${cell((p.roles ?? s.roles ?? []).join(', ') || undefined)} | ${cell((p.events ?? []).join(', ') || undefined)} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Fuentes', '', ...f.sources.map((s) => `- \`${s}\``), '');
  return lines.join('\n');
}

function index(): string {
  const rows = [...FIXTURES]
    .sort((a, b) => a.processId.localeCompare(b.processId))
    .map(
      (f) =>
        `| ${f.processId} | [${f.name}](${f.code}.md) | ${f.priority} | \`${f.ownerRole}\` | ${f.systems.join(', ')} | ${f.stages.length} | ${f.stages.reduce((n, s) => n + s.steps.length, 0)} |`,
    );
  return [
    HEADER,
    '',
    '# Procesos de Atlas',
    '',
    'Fuente: `src/modules/workflow-catalog/definitions/`. Cada proceso llega a la base por la migración `sync-workflow-catalog-N` y se consulta en el portal admin, sección **Procesos**. `P-nn` son los procesos del inventario; `C-nn`, recorridos compuestos que los enlazan.',
    '',
    '| Id | Proceso | Prioridad | Dueño | Bloques | Etapas | Pasos |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

/**
 * Versión para máquinas: la lee Flow Intelligence (`derive.mjs`) para emitir PROCESS_STEP_UNWIRED sin
 * compilar este repositorio. Sólo lo que hace falta para medir el cableado.
 */
function machine(): string {
  const processes = [...FIXTURES]
    .sort((a, b) => a.processId.localeCompare(b.processId))
    .map((f) => ({
      processId: f.processId,
      code: f.code,
      priority: f.priority,
      stages: f.stages.map((s) => ({
        code: s.code,
        actor: s.actor,
        client: s.client,
        screen: s.screen ?? null,
        steps: s.steps.map((p) => ({
          code: p.code,
          kind: p.kind ?? 'http',
          system: p.system ?? 'ATLAS_BACKEND',
          method: p.method ?? null,
          path: p.path ?? null,
        })),
      })),
    }));
  return `${JSON.stringify({ generatedBy: 'scripts/processes/generate-process-docs.ts', processes }, null, 1)}\n`;
}

const files = new Map<string, string>([
  ['README.md', index()],
  ['processes.json', machine()],
  ...FIXTURES.map((f) => [`${f.code}.md`, page(f)] as [string, string]),
]);
if (process.argv.includes('--check')) {
  const stale = [...files]
    .filter(([name, content]) => !existsSync(join(DIR, name)) || readFileSync(join(DIR, name), 'utf8') !== content)
    .map(([n]) => n);
  const orphan = existsSync(DIR) ? readdirSync(DIR).filter((n) => (n.endsWith('.md') || n === 'processes.json') && !files.has(n)) : [];
  for (const n of stale) console.error(`ERROR  docs/processes/${n} no está al día: corre yarn docs:processes`);
  for (const n of orphan) console.error(`ERROR  docs/processes/${n} no corresponde a ningún proceso`);
  console.log(`check:process-docs: ${files.size} páginas, ${stale.length + orphan.length} desfasadas.`);
  process.exit(stale.length + orphan.length ? 1 : 0);
}
mkdirSync(DIR, { recursive: true });
for (const [name, content] of files) writeFileSync(join(DIR, name), content);
console.log(`docs:processes: ${files.size} páginas escritas en docs/processes/.`);
