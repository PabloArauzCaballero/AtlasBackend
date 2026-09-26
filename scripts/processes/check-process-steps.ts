/**
 * Gate estático: cada paso de un proceso apunta a algo que existe.
 *
 * Un paso que nombra una ruta que nadie sirve manda a un tester a probar un endpoint inexistente y al
 * portal a medir un cableado imposible. Aquí se comprueba, sin levantar nada:
 *   - paso `http` del Backend → inventario de rutas por decoradores;
 *   - paso `http` del Motor, el ERP o Tableros → copia de sus endpoints (`docs/processes/external-endpoints.json`);
 *   - evento del Backend → `event-registry.ts`; job del Backend → `scheduled-jobs.catalog.ts`;
 *   - pasos que no son HTTP → dicen por qué (`reason`) o qué job los corre;
 *   - transiciones y dependencias → nombran pasos de la misma fixture.
 *
 * Ejecutar con `yarn check:process-steps`.
 */
import {
  backendEmittedEvents,
  backendEventCodes,
  backendJobCodes,
  backendRoutes,
  externalRoutes,
  FIXTURES,
  finish,
  normalizeRoute,
  routeRoles,
  stepsOf,
} from './process-catalog.lib.js';
import { WORKFLOW_CONDITION_TYPES } from '../../src/modules/workflow-catalog/workflow-catalog.constants.js';

const backend = backendRoutes();
const external = externalRoutes();
const events = backendEventCodes();
const emitted = backendEmittedEvents();
const isEmitted = (e: string) => emitted.literals.has(e) || emitted.prefixes.some((p) => e.startsWith(p));
const jobs = backendJobCodes();
const roles = routeRoles();
const CONDITIONS = new Set<string>(WORKFLOW_CONDITION_TYPES);
const errors: string[] = [];
const warnings: string[] = [];
let looked = 0;

/** El Motor declara algunas rutas bajo `v1/` y otras no; se prueba con y sin el prefijo. */
function served(system: string, method: string, path: string): boolean {
  const key = `${method.toUpperCase()} ${normalizeRoute(path)}`;
  if (system === 'ATLAS_BACKEND') return backend.has(key);
  const set = external.get(system);
  if (!set) return false;
  return set.has(key) || set.has(key.replace(' /v1/', ' /')) || set.has(key.replace(/^(\w+) \//, '$1 /v1/'));
}

for (const f of FIXTURES) {
  const refs = stepsOf(f);
  const codes = new Set<string>();
  for (const { stage, step } of refs) {
    looked++;
    const at = `${f.processId} ${f.code}/${stage}/${step.code}`;
    if (!step.name?.trim() || !step.description?.trim()) errors.push(`${at}: paso sin nombre o sin descripción`);
    if (codes.has(step.code)) errors.push(`${at}: código de paso repetido`);
    codes.add(step.code);
    const kind = step.kind ?? 'http';
    const system = step.system ?? 'ATLAS_BACKEND';
    if (kind === 'http') {
      if (!step.method || !step.path?.startsWith('/')) errors.push(`${at}: paso http sin método o sin ruta que empiece por /`);
      else if (!served(system, step.method, step.path)) {
        // AI_SERVICE y el mock no están en la copia: se avisa en vez de bloquear.
        if (system === 'AI_SERVICE' || system === 'EXTERNAL_PROVIDERS_MOCK')
          warnings.push(`${at}: ${step.method} ${step.path} en ${system} no se puede comprobar aquí`);
        else errors.push(`${at}: ${step.method} ${step.path} no existe en ${system}`);
      }
    } else if (kind === 'job') {
      if (!step.job) errors.push(`${at}: paso job sin job`);
      else if (system === 'ATLAS_BACKEND' && !jobs.has(step.job))
        errors.push(`${at}: job ${step.job} no está en scheduled-jobs.catalog.ts`);
    } else if (!step.reason || step.reason.trim().length < 20) {
      errors.push(`${at}: paso ${kind} sin «reason» (por qué no es una llamada HTTP)`);
    }
    // Un rol que el paso dice admitir y el controlador no: la ficha promete un acceso que da 403.
    if (kind === 'http' && step.roles?.length) {
      const declared = roles.get(system)?.get(`${(step.method ?? '').toUpperCase()} ${normalizeRoute(step.path ?? '/')}`);
      const extra = declared ? step.roles.filter((r) => !declared.has(r)) : [];
      if (extra.length)
        warnings.push(`${at}: roles ${extra.join(', ')} no los admite el controlador (admite ${[...declared!].join(', ')})`);
    }
    if (system === 'ATLAS_BACKEND') {
      for (const e of [...(step.events ?? []), ...(step.consumes ?? [])]) {
        if (events.has(e)) continue;
        // Un evento que nadie emite es una promesa falsa de la ficha; uno emitido y sin registrar,
        // un hueco del registro (`process_outbox` lo marca procesado sin avisar a nadie).
        if (isEmitted(e)) warnings.push(`${at}: evento ${e} se emite pero no está en event-registry.ts`);
        else errors.push(`${at}: evento ${e} no lo emite ni lo consume nadie en el código`);
      }
    }
  }
  for (const d of f.dependencies ?? []) {
    if (!codes.has(d.step) || !codes.has(d.dependsOn))
      errors.push(`${f.code}: dependencia ${d.step} → ${d.dependsOn} nombra un paso inexistente`);
  }
  for (const t of f.transitions ?? []) {
    if (!CONDITIONS.has(t.condition))
      errors.push(`${f.code}: transición ${t.code} con condición ${t.condition} (admitidas: ${[...CONDITIONS].join(', ')})`);
    if ((t.from && !codes.has(t.from)) || (t.to && !codes.has(t.to)))
      errors.push(`${f.code}: transición ${t.code} nombra un paso inexistente`);
  }
}

finish('check:process-steps', errors, warnings, looked);
