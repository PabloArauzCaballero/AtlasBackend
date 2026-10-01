#!/usr/bin/env node
/**
 * Gate de auditoría de dependencias (ATL-11). Sustituye al bloque `yarn audit | codigo & 24` de ci.yml.
 *
 * Un exit code de yarn NUNCA decide por sí solo: exit 1 es a la vez «sólo INFO» y «error operativo».
 * Se acepta únicamente una ejecución COMPLETA (resumen terminal válido que cuadra con el código) y
 * después se aplica la política de severidades. Ausencia de reporte ≠ ausencia de vulnerabilidades.
 *
 * Códigos de salida PROPIOS (no son la máscara de yarn; ésta queda en la evidencia):
 *   0 PASS · 2 hallazgos bloqueantes · 3 fallo operativo / reporte inválido · 4 configuración inválida.
 *
 * No hay bandera ni variable que acepte un reporte previo, un fixture o un fallo permitido: la única
 * fuente es el proceso que este script lanza. Los tests sustituyen el proveedor (PATH con un `yarn`
 * falso o `runAuditGate({ command })`), nunca el workflow.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateAudit, parseCompletedAudit } from './parse-yarn-classic-audit.mjs';

export const EXIT = { PASS: 0, BLOCKED_FINDINGS: 2, OPERATIONAL_ERROR: 3, INVALID_CONFIGURATION: 4 };

const DEFAULTS = { timeoutMs: 300_000, maxOutputBytes: 16 * 1024 * 1024, attempts: 3, retryDelayMs: 2_000, killGraceMs: 2_000 };

function readPositiveInt(raw, fallback, { min, max, name }) {
  if (raw === undefined || raw === '') return { value: fallback };
  if (!/^\d+$/.test(raw)) return { error: `${name} debe ser un entero` };
  const value = Number(raw);
  if (value < min || value > max) return { error: `${name} fuera de rango (${min}..${max})` };
  return { value };
}

/** Lanza un proceso sin shell, con presupuesto de tiempo y de salida; separa stdout/stderr. */
export function runProcess(command, args, { cwd, env, timeoutMs, maxOutputBytes, killGraceMs }) {
  return new Promise((resolveOutcome) => {
    let child;
    const outcome = { stdout: '', stderr: '', exitCode: null, signal: null, timedOut: false, truncated: false, spawnError: null };
    let settled = false;
    let bytes = 0;
    let killTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      clearTimeout(killTimer);
      resolveOutcome(outcome);
    };
    const terminate = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    };
    try {
      child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      outcome.spawnError = error.message;
      resolveOutcome(outcome);
      return;
    }
    const budgetTimer = setTimeout(() => {
      outcome.timedOut = true;
      terminate();
    }, timeoutMs);
    const collect = (stream) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        if (!outcome.truncated) {
          outcome.truncated = true;
          terminate();
        }
        return;
      }
      outcome[stream] += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => {
      outcome.spawnError = error.message;
      finish();
    });
    // `close` espera a que los pipes se vacíen: no se evalúa una salida a medias.
    child.on('close', (code, signal) => {
      outcome.exitCode = code;
      outcome.signal = signal;
      finish();
    });
  });
}

function loadExceptions(path) {
  if (!existsSync(path)) return { exceptions: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed.exceptions)) return { error: `${path}: falta el arreglo \`exceptions\`` };
    return { exceptions: parsed.exceptions };
  } catch (error) {
    return { error: `${path}: JSON inválido (${error.message})` };
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * @param {{command?:string, cwd?:string, env?:NodeJS.ProcessEnv, log?:(line:string)=>void}} options
 * @returns {Promise<{exitCode:number, report:object}>}
 */
export async function runAuditGate({ command = 'yarn', cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  const startedAt = new Date();
  const report = {
    schema: 'atlas.dependency-audit/1',
    tool: { command, protocol: 'yarn-classic-json-lines' },
    source: {
      commit: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      lockfileSha256: null,
    },
    scope: { groups: 'yarn-default (dependencies, devDependencies, optionalDependencies)', workspaces: 'yarn-default' },
    startedAt: startedAt.toISOString(),
    attempts: [],
    decision: null,
    gateExitCode: null,
    reason: null,
  };
  const conclude = (decision, reason, extra = {}) => {
    report.decision = decision;
    report.reason = reason;
    report.gateExitCode = EXIT[decision];
    report.finishedAt = new Date().toISOString();
    Object.assign(report, extra);
    return { exitCode: EXIT[decision], report };
  };

  const timeout = readPositiveInt(env.AUDIT_TIMEOUT_MS, DEFAULTS.timeoutMs, { min: 1_000, max: 1_800_000, name: 'AUDIT_TIMEOUT_MS' });
  const attemptsCfg = readPositiveInt(env.AUDIT_ATTEMPTS, DEFAULTS.attempts, { min: 1, max: 5, name: 'AUDIT_ATTEMPTS' });
  const maxOut = readPositiveInt(env.AUDIT_MAX_OUTPUT_BYTES, DEFAULTS.maxOutputBytes, { min: 1_024, max: 256 * 1024 * 1024, name: 'AUDIT_MAX_OUTPUT_BYTES' });
  const retryDelay = readPositiveInt(env.AUDIT_RETRY_DELAY_MS, DEFAULTS.retryDelayMs, { min: 0, max: 60_000, name: 'AUDIT_RETRY_DELAY_MS' });
  const configError = timeout.error ?? attemptsCfg.error ?? maxOut.error ?? retryDelay.error;
  if (configError) return conclude('INVALID_CONFIGURATION', configError);

  const lockfile = resolve(cwd, 'yarn.lock');
  if (!existsSync(lockfile)) return conclude('INVALID_CONFIGURATION', 'no hay yarn.lock: no se sabe qué grafo se audita');
  report.source.lockfileSha256 = sha256(lockfile);

  const limits = { cwd, env, timeoutMs: timeout.value, maxOutputBytes: maxOut.value, killGraceMs: DEFAULTS.killGraceMs };
  const version = await runProcess(command, ['--version'], limits);
  const versionText = version.stdout.trim();
  if (version.exitCode !== 0 || version.signal || !/^1\.\d+\.\d+$/.test(versionText)) {
    return conclude('INVALID_CONFIGURATION', `se esperaba Yarn Classic 1.x y se obtuvo «${versionText.slice(0, 40)}» (exit ${version.exitCode})`);
  }
  report.tool.version = versionText;

  const exceptionsFile = loadExceptions(resolve(cwd, env.AUDIT_EXCEPTIONS_FILE ?? '.github/audit-exceptions.json'));
  if (exceptionsFile.error) return conclude('INVALID_CONFIGURATION', exceptionsFile.error);

  let lastFailure = null;
  for (let attempt = 1; attempt <= attemptsCfg.value; attempt++) {
    const started = Date.now();
    const outcome = await runProcess(command, ['audit', '--json'], limits);
    const parsed = parseCompletedAudit(outcome);
    report.attempts.push({
      attempt,
      durationMs: Date.now() - started,
      yarnExitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      truncated: outcome.truncated,
      stdoutBytes: Buffer.byteLength(outcome.stdout),
      stderrBytes: Buffer.byteLength(outcome.stderr),
      result: parsed.ok ? 'COMPLETED' : parsed.kind,
      reason: parsed.ok ? null : parsed.reason,
    });
    log(`[audit] intento ${attempt}: yarn exit ${outcome.exitCode}${outcome.signal ? ` señal ${outcome.signal}` : ''} → ${parsed.ok ? 'completo' : `${parsed.kind}: ${parsed.reason}`}`);
    if (parsed.ok) {
      const verdict = evaluateAudit(parsed, { exceptions: exceptionsFile.exceptions });
      const common = {
        yarnExitMask: parsed.exitMask,
        vulnerabilities: parsed.summary.vulnerabilities,
        dependencies: parsed.summary.totalDependencies,
        blocking: verdict.blocking,
        excepted: verdict.excepted,
      };
      if (verdict.decision === 'BLOCKED_FINDINGS') {
        return conclude('BLOCKED_FINDINGS', `${verdict.blocking.length} aviso(s) high/critical sin excepción vigente`, common);
      }
      const suffix = verdict.decision === 'PASS_WITH_EXCEPTIONS' ? ' (con excepciones vigentes)' : '';
      return conclude('PASS', `auditoría completa sin hallazgos high/critical bloqueantes${suffix}`, common);
    }
    lastFailure = parsed;
    if (!parsed.transient || attempt === attemptsCfg.value) break;
    await new Promise((done) => setTimeout(done, retryDelay.value * attempt));
  }
  return conclude('OPERATIONAL_ERROR', `${lastFailure.kind}: ${lastFailure.reason}`);
}

async function main() {
  const { exitCode, report } = await runAuditGate();
  const dir = resolve(process.env.AUDIT_EVIDENCE_DIR ?? 'audit-evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'dependency-audit-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const line = `Auditoría de dependencias: ${report.decision} — ${report.reason}`;
  if (exitCode === EXIT.PASS) console.log(line);
  else console.error(`::error::${line}`);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::Auditoría de dependencias: fallo inesperado del gate (${error.message})`);
    process.exitCode = EXIT.OPERATIONAL_ERROR;
  });
}
