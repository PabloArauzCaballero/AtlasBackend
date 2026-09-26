#!/usr/bin/env node
/** Verifica el artefacto que responde al tráfico después de que Coolify terminó. */
const base = process.env.SMOKE_BASE_URL;
const targetSha = process.env.TARGET_SHA;
const attempts = Number(process.env.SMOKE_ATTEMPTS ?? '12');

if (!base || !/^https?:\/\//.test(base)) throw new Error('SMOKE_BASE_URL debe ser una URL HTTP(S) explícita.');
if (!/^[a-f0-9]{40}$/i.test(targetSha ?? '')) throw new Error('TARGET_SHA debe ser un SHA Git de 40 caracteres.');
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) throw new Error('SMOKE_ATTEMPTS inválido.');

const origin = new URL(base);
if (origin.username || origin.password || origin.search || origin.hash)
  throw new Error('SMOKE_BASE_URL no debe contener credenciales ni query.');
const endpoint = (path) => new URL(`${origin.pathname.replace(/\/$/, '')}${path}`, origin);

async function get(path) {
  const response = await fetch(endpoint(path), { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.data ?? payload;
}

async function ready() {
  const live = await get('/api/v1/health/liveness');
  if (live?.status !== 'alive') throw new Error('Liveness no reporta alive.');
  const readiness = await get('/api/v1/health/readiness');
  if (readiness?.status !== 'ready') throw new Error('Readiness no reporta ready.');
}

let lastError;
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    await ready();
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
if (lastError) throw lastError;

const health = await get('/api/v1/health');
if (health?.service !== 'atlas-backend' || health?.status !== 'ok') throw new Error('Health del backend no reporta servicio sano.');
if (!health?.version || health.version === '0.0.0-unknown') throw new Error('La versión del artefacto es desconocida.');
if (health?.commit !== targetSha) throw new Error(`SHA servido ${health?.commit ?? '(vacío)'} difiere del SHA validado ${targetSha}.`);
console.log(`Smoke OK: ${health.service} ${health.version} commit ${health.commit}; live y ready sanos.`);
