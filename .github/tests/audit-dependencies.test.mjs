/**
 * ATL-11 · AU-01..AU-20. El auditor real no se toca: un `yarn` falso (PATH o `command`) entrega los
 * mismos registros JSON-lines que Yarn Classic 1.22.22 (forma verificada con una corrida real:
 * N × auditAdvisory + 1 × auditSummary; exit = máscara del resumen).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EXIT, runAuditGate } from '../../scripts/security/audit-dependencies.mjs';
import { evaluateAudit, parseCompletedAudit } from '../../scripts/security/parse-yarn-classic-audit.mjs';

const cli = new URL('../../scripts/security/audit-dependencies.mjs', import.meta.url).pathname;
const ciYml = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');

const BIT = { info: 1, low: 2, moderate: 4, high: 8, critical: 16 };
const line = (type, data) => `${JSON.stringify({ type, data })}\n`;
const advisory = (severity, id = 1000) =>
  line('auditAdvisory', {
    resolution: { id, path: `app>pkg-${id}`, dev: false, optional: false, bundled: false },
    advisory: { id, severity, module_name: `pkg-${id}`, github_advisory_id: `GHSA-test-${id}` },
  });
const summary = (counts = {}, extra = {}) =>
  line('auditSummary', {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts },
    dependencies: 40,
    devDependencies: 0,
    optionalDependencies: 0,
    totalDependencies: 40,
    ...extra,
  });
const maskOf = (counts) => Object.entries(counts).reduce((m, [k, v]) => (v > 0 ? m | BIT[k] : m), 0);
const completed = (counts, advisories = '') => ({ stdout: advisories + summary(counts), stderr: '', exitCode: maskOf(counts), signal: null });

// ---- parser puro --------------------------------------------------------------------------------

test('AU-01 histórico: exit 1 sin reporte es rechazado (el wrapper viejo lo aprobaba con `codigo & 24`)', () => {
  assert.equal((1 & 24) === 0, true, 'reproduce el falso verde del bloque histórico');
  const result = parseCompletedAudit({ stdout: '', stderr: '', exitCode: 1, signal: null });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'PROTOCOL_ERROR');
});

test('AU-02 reporte limpio válido: PASS con contadores reales', () => {
  const result = parseCompletedAudit(completed({}));
  assert.equal(result.ok, true);
  assert.equal(result.summary.totalDependencies, 40);
  assert.equal(evaluateAudit(result).decision, 'PASS');
});

test('AU-03 exit 1 con INFO válido y completo: PASS (no es error operativo)', () => {
  const result = parseCompletedAudit(completed({ info: 3 }, advisory('info')));
  assert.equal(result.ok, true);
  assert.equal(result.exitMask, 1);
  assert.equal(evaluateAudit(result).decision, 'PASS');
});

test('AU-04 HIGH válido: BLOCKED_FINDINGS', () => {
  const result = parseCompletedAudit(completed({ high: 1 }, advisory('high')));
  assert.equal(evaluateAudit(result).decision, 'BLOCKED_FINDINGS');
});

test('AU-05 CRITICAL y HIGH combinados: ambos quedan registrados', () => {
  const result = parseCompletedAudit(completed({ high: 1, critical: 1 }, advisory('high', 1) + advisory('critical', 2)));
  const verdict = evaluateAudit(result);
  assert.equal(verdict.decision, 'BLOCKED_FINDINGS');
  assert.deepEqual(verdict.blocking.map((a) => a.severity).sort(), ['critical', 'high']);
});

test('AU-04b hallazgos moderados no bloquean (política vigente high/critical)', () => {
  const result = parseCompletedAudit(completed({ moderate: 10 }, advisory('moderate')));
  assert.equal(evaluateAudit(result).decision, 'PASS');
});

test('AU-06 exit 0 y stdout vacío: nunca PASS', () => {
  const result = parseCompletedAudit({ stdout: '', stderr: '', exitCode: 0, signal: null });
  assert.equal(result.ok, false);
});

test('AU-07 error DNS/HTTP sin resumen, con exit 1 (coincide con INFO): rechazo operativo y transitorio', () => {
  const result = parseCompletedAudit({
    stdout: '',
    stderr: line('error', 'getaddrinfo ENOTFOUND registry.yarnpkg.com'),
    exitCode: 1,
    signal: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'OPERATIONAL_ERROR');
  assert.equal(result.transient, true);
});

test('AU-07b autenticación fallida: operativo y NO transitorio (no se reintenta)', () => {
  const result = parseCompletedAudit({ stdout: '', stderr: line('error', 'Request failed "401 Unauthorized"'), exitCode: 1, signal: null });
  assert.equal(result.kind, 'OPERATIONAL_ERROR');
  assert.notEqual(result.transient, true);
});

test('AU-08 JSON-line truncada entre registros: rechazo, sin resumen parcial favorable', () => {
  const truncated = advisory('moderate') + '{"type":"auditAdvisory","data":{"resolu\n' + summary({ moderate: 1 });
  const result = parseCompletedAudit({ stdout: truncated, stderr: '', exitCode: 4, signal: null });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no es JSON/);
});

test('AU-09 resumen sin campo obligatorio, contadores negativos o no numéricos: rechazo (no se convierte en cero)', () => {
  const base = JSON.parse(summary({}));
  const variants = [
    (d) => delete d.data.vulnerabilities.high,
    (d) => (d.data.vulnerabilities.critical = -1),
    (d) => (d.data.vulnerabilities.low = '0'),
    (d) => (d.data.vulnerabilities.moderate = 1.5),
    (d) => delete d.data.totalDependencies,
    (d) => (d.data.totalDependencies = 0),
    (d) => (d.data.vulnerabilities.unknown = 0),
  ];
  for (const mutate of variants) {
    const copy = structuredClone(base);
    mutate(copy);
    const result = parseCompletedAudit({ stdout: `${JSON.stringify(copy)}\n`, stderr: '', exitCode: 0, signal: null });
    assert.equal(result.ok, false, JSON.stringify(copy));
    assert.equal(result.kind, 'PROTOCOL_ERROR');
  }
});

test('AU-10 resúmenes múltiples o registros tras el resumen: rechazo, no se elige el más favorable', () => {
  const dos = summary({ high: 1 }) + summary({});
  assert.equal(parseCompletedAudit({ stdout: dos, stderr: '', exitCode: 0, signal: null }).ok, false);
  const despues = summary({}) + advisory('info');
  assert.equal(parseCompletedAudit({ stdout: despues, stderr: '', exitCode: 0, signal: null }).ok, false);
});

test('AU-11 código fuera de protocolo (32) y máscara incoherente con el resumen: rechazo explícito', () => {
  assert.equal(parseCompletedAudit({ ...completed({}), exitCode: 32 }).ok, false);
  assert.equal(parseCompletedAudit({ ...completed({ info: 1 }), exitCode: 32 }).ok, false);
  // resumen limpio pero el proceso salió con 1: contradictorio, no «sólo INFO»
  const result = parseCompletedAudit({ ...completed({}), exitCode: 1 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /máscara/);
  // aviso high impreso mientras el resumen dice high = 0
  assert.equal(parseCompletedAudit({ stdout: advisory('high') + summary({}), stderr: '', exitCode: 0, signal: null }).ok, false);
});

test('AU-13 resumen aparentemente limpio seguido de un evento de error: rechazo', () => {
  const result = parseCompletedAudit({ ...completed({}), stderr: line('error', 'algo falló después') });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'OPERATIONAL_ERROR');
  const enStdout = parseCompletedAudit({ stdout: summary({}) + line('error', 'tarde'), stderr: '', exitCode: 0, signal: null });
  assert.equal(enStdout.ok, false);
});

test('registros benignos conocidos (warning/info) no rompen una auditoría completa; los desconocidos sí', () => {
  const ok = parseCompletedAudit({
    ...completed({}),
    stderr: line('warning', 'package.json: No license field') + '(node:1234) [DEP0040] DeprecationWarning: punycode\n',
  });
  assert.equal(ok.ok, true);
  const raro = parseCompletedAudit({ ...completed({}), stderr: line('tabla-nueva', 'x') });
  assert.equal(raro.ok, false);
  const stderrRuido = parseCompletedAudit({ ...completed({}), stderr: 'texto libre inesperado\n' });
  assert.equal(stderrRuido.ok, false);
});

test('AU-12 señal, timeout, truncamiento o fallo de arranque: rechazo con causa', () => {
  assert.match(parseCompletedAudit({ ...completed({}), exitCode: null, signal: 'SIGKILL' }).reason, /SIGKILL/);
  assert.match(parseCompletedAudit({ ...completed({}), timedOut: true }).reason, /tiempo/);
  assert.match(parseCompletedAudit({ ...completed({}), truncated: true }).reason, /límite/);
  assert.match(parseCompletedAudit({ stdout: '', stderr: '', exitCode: null, signal: null, spawnError: 'ENOENT' }).reason, /ENOENT/);
});

test('AU-20 excepción ausente, caducada, sin responsable o parcial: BLOCKED; vigente y completa: PASS_WITH_EXCEPTIONS', () => {
  const result = parseCompletedAudit(completed({ high: 1 }, advisory('high', 77)));
  const now = new Date('2026-10-01T00:00:00Z');
  const exc = { advisory: 'GHSA-test-77', owner: 'rol:seguridad', reason: 'no alcanzable en runtime (síntesis de prueba)', expires: '2026-12-31T00:00:00Z' };
  assert.equal(evaluateAudit(result, { now }).decision, 'BLOCKED_FINDINGS');
  assert.equal(evaluateAudit(result, { now, exceptions: [{ ...exc, expires: '2026-09-01T00:00:00Z' }] }).decision, 'BLOCKED_FINDINGS');
  assert.equal(evaluateAudit(result, { now, exceptions: [{ ...exc, owner: '' }] }).decision, 'BLOCKED_FINDINGS');
  assert.equal(evaluateAudit(result, { now, exceptions: [{ ...exc, expires: 'mañana' }] }).decision, 'BLOCKED_FINDINGS');
  assert.equal(evaluateAudit(result, { now, exceptions: [exc] }).decision, 'PASS_WITH_EXCEPTIONS');
  // el resumen cuenta 2 high pero sólo se detalla 1: la excepción no puede ocultar el otro
  const oculto = parseCompletedAudit(completed({ high: 2 }, advisory('high', 77)));
  assert.equal(evaluateAudit(oculto, { now, exceptions: [exc] }).decision, 'BLOCKED_FINDINGS');
});

// ---- proceso: yarn falso por PATH ---------------------------------------------------------------

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1\n');
  const bin = join(dir, 'yarn');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write(process.env.FAKE_VERSION ?? '1.22.22\\n'); process.exit(0); }
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, 'utf8'));
const counter = process.env.FAKE_PLAN + '.n';
const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
writeFileSync(counter, String(n + 1));
const step = plan[Math.min(n, plan.length - 1)];
if (step.stdout) process.stdout.write(step.stdout);
if (step.stderr) process.stderr.write(step.stderr);
if (step.flood) { const chunk = 'x'.repeat(65536); (function pump(){ while (process.stdout.write(chunk)); process.stdout.once('drain', pump); })(); return; }
if (step.hang) { setInterval(() => {}, 1000); return; }
if (step.killSelf) process.kill(process.pid, 'SIGKILL');
process.exit(step.exit);
`,
  );
  chmodSync(bin, 0o755);
  const plan = (steps) => {
    const file = join(dir, 'plan.json');
    writeFileSync(file, JSON.stringify(steps));
    return file;
  };
  return { dir, bin, plan };
}

const env = (s, steps, extra = {}) => ({ ...process.env, FAKE_PLAN: s.plan(steps), AUDIT_RETRY_DELAY_MS: '0', ...extra });
const quiet = () => {};

test('proceso: AU-03 exit 1 con INFO completo pasa; AU-01 exit 1 sin reporte rechaza (misma máscara, distinto resultado)', async () => {
  const s = sandbox();
  const info = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ stdout: advisory('info') + summary({ info: 1 }), exit: 1 }]) });
  assert.equal(info.exitCode, EXIT.PASS);
  assert.equal(info.report.yarnExitMask, 1);
  const s2 = sandbox();
  const vacio = await runAuditGate({ command: s2.bin, cwd: s2.dir, log: quiet, env: env(s2, [{ stdout: '', exit: 1 }], { AUDIT_ATTEMPTS: '1' }) });
  assert.equal(vacio.exitCode, EXIT.OPERATIONAL_ERROR);
});

test('proceso: AU-04/05 HIGH y CRITICAL devuelven 2 con evidencia; AU-02 limpio devuelve 0', async () => {
  const s = sandbox();
  const high = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ stdout: advisory('high', 5) + summary({ high: 1 }), exit: 8 }]) });
  assert.equal(high.exitCode, EXIT.BLOCKED_FINDINGS);
  assert.equal(high.report.blocking[0].id, 5);
  const s2 = sandbox();
  const limpio = await runAuditGate({ command: s2.bin, cwd: s2.dir, log: quiet, env: env(s2, [{ stdout: summary({}), exit: 0 }]) });
  assert.equal(limpio.exitCode, EXIT.PASS);
  assert.equal(limpio.report.source.lockfileSha256.length, 64);
});

test('proceso: AU-06/AU-11 exit 0 sin salida y exit 32 se rechazan', async () => {
  for (const step of [{ stdout: '', exit: 0 }, { stdout: summary({}), exit: 32 }]) {
    const s = sandbox();
    const result = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [step], { AUDIT_ATTEMPTS: '1' }) });
    assert.equal(result.exitCode, EXIT.OPERATIONAL_ERROR);
  }
});

test('proceso: AU-12 timeout mata al hijo y conserva la causa; señal tras salida parcial se rechaza', async () => {
  const s = sandbox();
  const t0 = Date.now();
  const hang = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ hang: true }], { AUDIT_TIMEOUT_MS: '1000', AUDIT_ATTEMPTS: '1' }) });
  assert.equal(hang.exitCode, EXIT.OPERATIONAL_ERROR);
  assert.equal(hang.report.attempts[0].timedOut, true);
  assert.ok(Date.now() - t0 < 8000, 'el proceso colgado se termina dentro del presupuesto');
  const s2 = sandbox();
  const signal = await runAuditGate({ command: s2.bin, cwd: s2.dir, log: quiet, env: env(s2, [{ stdout: advisory('moderate'), killSelf: true }], { AUDIT_ATTEMPTS: '1' }) });
  assert.equal(signal.exitCode, EXIT.OPERATIONAL_ERROR);
  assert.equal(signal.report.attempts[0].signal, 'SIGKILL');
});

test('proceso: AU-15 salida que excede el límite se rechaza sin aprobar una versión truncada', async () => {
  const s = sandbox();
  const result = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ flood: true }], { AUDIT_MAX_OUTPUT_BYTES: '4096', AUDIT_ATTEMPTS: '1', AUDIT_TIMEOUT_MS: '20000' }) });
  assert.equal(result.exitCode, EXIT.OPERATIONAL_ERROR);
  assert.equal(result.report.attempts[0].truncated, true);
});

test('proceso: AU-18 fallo transitorio y luego intento completo; decide un intento completo y conserva los fallos', async () => {
  const s = sandbox();
  const result = await runAuditGate({
    command: s.bin,
    cwd: s.dir,
    log: quiet,
    env: env(s, [{ stderr: line('error', 'getaddrinfo EAI_AGAIN registry'), exit: 1 }, { stdout: summary({}), exit: 0 }]),
  });
  assert.equal(result.exitCode, EXIT.PASS);
  assert.deepEqual(result.report.attempts.map((a) => a.result), ['OPERATIONAL_ERROR', 'COMPLETED']);
});

test('proceso: reintentos acotados (no infinitos) y los permanentes no se reintentan', async () => {
  const s = sandbox();
  const transient = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ stderr: line('error', 'ETIMEDOUT'), exit: 1 }], { AUDIT_ATTEMPTS: '3' }) });
  assert.equal(transient.exitCode, EXIT.OPERATIONAL_ERROR);
  assert.equal(transient.report.attempts.length, 3);
  const s2 = sandbox();
  const permanent = await runAuditGate({ command: s2.bin, cwd: s2.dir, log: quiet, env: env(s2, [{ stderr: line('error', '401 Unauthorized'), exit: 1 }], { AUDIT_ATTEMPTS: '3' }) });
  assert.equal(permanent.report.attempts.length, 1);
});

test('proceso: AU-14/AU-17 configuración inválida: sin yarn.lock, yarn no Classic, variables mal formadas → 4', async () => {
  const s = sandbox();
  const sinLock = await runAuditGate({ command: s.bin, cwd: tmpdir(), log: quiet, env: env(s, [{ stdout: summary({}), exit: 0 }]) });
  assert.equal(sinLock.exitCode, EXIT.INVALID_CONFIGURATION);
  const berry = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ stdout: summary({}), exit: 0 }], { FAKE_VERSION: '4.9.1\n' }) });
  assert.equal(berry.exitCode, EXIT.INVALID_CONFIGURATION);
  for (const bad of [{ AUDIT_ATTEMPTS: '0' }, { AUDIT_ATTEMPTS: 'x' }, { AUDIT_TIMEOUT_MS: '5' }, { AUDIT_MAX_OUTPUT_BYTES: '-1' }]) {
    const r = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, [{ stdout: summary({}), exit: 0 }], bad) });
    assert.equal(r.exitCode, EXIT.INVALID_CONFIGURATION, JSON.stringify(bad));
  }
  const noExiste = await runAuditGate({ command: join(s.dir, 'no-existe'), cwd: s.dir, log: quiet, env: env(s, []) });
  assert.equal(noExiste.exitCode, EXIT.INVALID_CONFIGURATION);
});

test('proceso: AU-20 el archivo de excepciones se lee del repo y una excepción caducada no salva', async () => {
  const s = sandbox();
  const steps = [{ stdout: advisory('high', 9) + summary({ high: 1 }), exit: 8 }];
  writeFileSync(join(s.dir, 'exc.json'), JSON.stringify({ exceptions: [{ advisory: '9', owner: 'rol:seguridad', reason: 'prueba', expires: '2020-01-01T00:00:00Z' }] }));
  const caducada = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, steps, { AUDIT_EXCEPTIONS_FILE: 'exc.json' }) });
  assert.equal(caducada.exitCode, EXIT.BLOCKED_FINDINGS);
  writeFileSync(join(s.dir, 'exc.json'), '{no es json');
  const rota = await runAuditGate({ command: s.bin, cwd: s.dir, log: quiet, env: env(s, steps, { AUDIT_EXCEPTIONS_FILE: 'exc.json' }) });
  assert.equal(rota.exitCode, EXIT.INVALID_CONFIGURATION);
});

// ---- CLI tal como lo invoca CI -----------------------------------------------------------------

async function runCli(s, steps, extraEnv = {}) {
  const child = spawn(process.execPath, [cli], {
    cwd: s.dir,
    env: { ...env(s, steps, { PATH: `${s.dir}:${process.env.PATH}`, AUDIT_EVIDENCE_DIR: join(s.dir, 'evidence') }), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => (stderr += c));
  child.stdout.resume();
  const [status] = await once(child, 'close');
  return { status, stderr, evidence: () => JSON.parse(readFileSync(join(s.dir, 'evidence', 'dependency-audit-report.json'), 'utf8')) };
}

test('CLI: escribe evidencia siempre y mapea la decisión al código propio (0/2/3), no a la máscara de yarn', async () => {
  const pass = await runCli(sandbox(), [{ stdout: advisory('info') + summary({ info: 1 }), exit: 1 }]);
  assert.equal(pass.status, 0);
  assert.equal(pass.evidence().decision, 'PASS');
  const blocked = await runCli(sandbox(), [{ stdout: advisory('critical', 3) + summary({ critical: 1 }), exit: 16 }]);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /::error::/);
  const roto = await runCli(sandbox(), [{ stdout: '', exit: 1 }], { AUDIT_ATTEMPTS: '1' });
  assert.equal(roto.status, 3);
  assert.equal(roto.evidence().decision, 'OPERATIONAL_ERROR');
});

test('AU-19 no existe entrada que acepte un reporte previo: una variable con un reporte «limpio» no cambia el veredicto', async () => {
  const s = sandbox();
  writeFileSync(join(s.dir, 'viejo.json'), summary({}));
  const r = await runCli(s, [{ stdout: '', exit: 1 }], { AUDIT_ATTEMPTS: '1', AUDIT_REPORT: join(s.dir, 'viejo.json'), ALLOW_AUDIT_FAILURE: 'true' });
  assert.equal(r.status, 3);
});

// ---- cableado en el workflow -------------------------------------------------------------------

test('AU-16 el workflow ejecuta el wrapper, sin tee/pipe/máscara/continue-on-error, y release-gate depende del job', () => {
  const job = ciYml.slice(ciYml.indexOf('  dependency-audit:'), ciYml.indexOf('  # Fase 4.1 del plan 10/10'));
  assert.match(job, /node scripts\/security\/audit-dependencies\.mjs/);
  assert.doesNotMatch(job, /^\s*(run:\s*)?yarn audit/m);
  assert.doesNotMatch(job, /&\s*24|\|\|\s*true|\|\s*tee|continue-on-error|set \+e/);
  assert.match(job, /if: always\(\)[\s\S]*upload-artifact/);
  assert.match(ciYml, /needs: \[[^\]]*dependency-audit[^\]]*\]/);
});
