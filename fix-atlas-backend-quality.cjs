const fs = require('fs');
const path = require('path');

const root = process.cwd();

const unusedImports = [
  { file: 'src/modules/sessions/sessions.repository.ts', names: ['CustomerActivitySummaryModel'] },

  { file: 'test/unit/catalog-management/catalog-ingestion.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/catalog-management/catalog-risk-policy.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/catalog-management/catalog-version-workflow.service.spec.ts', names: ['beforeEach', 'UnprocessableEntityException'] },

  { file: 'test/unit/customer-onboarding/customer-contact-verification.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/customer-onboarding/customer-identity-package.service.spec.ts', names: ['UnprocessableEntityException'] },

  { file: 'test/unit/customer-privacy/customer-privacy.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/customer-telemetry/customer-telemetry.service.spec.ts', names: ['UnprocessableEntityException'] },

  { file: 'test/unit/events/events.service.spec.ts', names: ['BadRequestException'] },

  { file: 'test/unit/external-data/external-provider-registry.service.spec.ts', names: ['beforeEach'] },

  { file: 'test/unit/operations/operations.service.spec.ts', names: ['UnprocessableEntityException'] },

  { file: 'test/unit/sessions/session-end.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/sessions/session-heartbeat.service.spec.ts', names: ['UnprocessableEntityException'] },
  { file: 'test/unit/sessions/session-start.service.spec.ts', names: ['UnprocessableEntityException'] },
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function writeFile(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function splitImportSpecifiers(specifiersText) {
  return specifiersText
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean);
}

function importedName(specifier) {
  return specifier.split(/\s+as\s+/i)[0].trim();
}

function removeNamedImport(content, nameToRemove) {
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*(['"][^'"]+['"]);\r?\n?/g;

  return content.replace(importRegex, (statement, specifiersText, sourceText) => {
    if (!statement.includes(nameToRemove)) return statement;

    const specifiers = splitImportSpecifiers(specifiersText);
    const keptSpecifiers = specifiers.filter((specifier) => importedName(specifier) !== nameToRemove);

    if (keptSpecifiers.length === specifiers.length) return statement;

    const newline = statement.endsWith('\r\n') ? '\r\n' : statement.endsWith('\n') ? '\n' : '';
    if (keptSpecifiers.length === 0) return '';

    const wasMultiline = statement.includes('\n') || statement.includes('\r');
    if (wasMultiline || keptSpecifiers.length > 3) {
      return `import {\n  ${keptSpecifiers.join(',\n  ')},\n} from ${sourceText};${newline}`;
    }

    return `import { ${keptSpecifiers.join(', ')} } from ${sourceText};${newline}`;
  });
}

function removeUnusedImports() {
  for (const item of unusedImports) {
    const absolutePath = path.join(root, item.file);
    if (!fs.existsSync(absolutePath)) {
      console.warn(`[SKIP] No existe ${item.file}`);
      continue;
    }

    let content = readFile(item.file);
    const before = content;

    for (const name of item.names) {
      content = removeNamedImport(content, name);
    }

    if (content !== before) {
      writeFile(item.file, content);
      console.log(`[OK] Imports limpiados: ${item.file}`);
    } else {
      console.log(`[OK] Sin cambios necesarios: ${item.file}`);
    }
  }
}

function patchNotificationOrchestrator() {
  const file = 'src/modules/notifications/notification-orchestrator.service.ts';
  let content = readFile(file);
  const before = content;

  if (content.includes('const rulesToApply = Array.isArray(rules) ? rules : [];')) {
    console.log('[OK] NotificationOrchestratorService ya estaba parcheado.');
    return;
  }

  const exactPattern = /const rules = this\.rulesService\.getRulesForEvent\(event\.eventCode\);\s*for \(const rule of rules\) \{/;

  if (exactPattern.test(content)) {
    content = content.replace(
      exactPattern,
      [
        'const rules = await Promise.resolve(this.rulesService.getRulesForEvent(event.eventCode));',
        '    const rulesToApply = Array.isArray(rules) ? rules : [];',
        '    for (const rule of rulesToApply) {',
      ].join('\n'),
    );
  } else {
    throw new Error(
      [
        'No se encontrÃ³ el patrÃ³n esperado en NotificationOrchestratorService.',
        'Busca manualmente:',
        '  const rules = this.rulesService.getRulesForEvent(event.eventCode);',
        '  for (const rule of rules) {',
        'y reemplazalo por la version async/segura indicada por el contrato del orquestador.',
      ].join('\n'),
    );
  }

  if (content !== before) {
    writeFile(file, content);
    console.log('[OK] NotificationOrchestratorService parcheado para reglas sync/async.');
  }
}

removeUnusedImports();
patchNotificationOrchestrator();
