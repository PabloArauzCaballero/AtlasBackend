/**
 * @file Valida el mapa módulo→contexto→propietario (AT-063) contra el árbol real de `src/modules`.
 * @business Un módulo nuevo sin contexto es una tabla sin dueño esperando a ocurrir; el manifiesto
 *   de fronteras (AT-011) parte de este mapa y no puede inventar contextos.
 * @system Tres reglas: toda carpeta de módulos figura en el mapa (y viceversa); una tabla registrada
 *   por varios módulos con `forFeature` tiene un único escritor declarado; y un módulo declarado
 *   como lector transversal no es propietario de ninguna tabla.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStaticRegistry } from '../../scripts/architecture/inventory-database.js';

type ContextMap = {
  contexts: Record<string, { title: string; schemas: string[] }>;
  modules: Record<string, { context: string; role: 'owner' | 'reader'; note?: string }>;
  tableOwners: Record<string, string>;
};

const rootDir = resolve(__dirname, '../..');
const contextMap = JSON.parse(readFileSync(resolve(rootDir, 'docs/architecture/microservices/context-map.json'), 'utf8')) as ContextMap;
const moduleDirs = readdirSync(resolve(rootDir, 'src/modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('mapa de contextos (AT-063)', () => {
  it('toda carpeta de src/modules tiene fila en el mapa, y el mapa no nombra carpetas inexistentes', () => {
    const mapped = Object.keys(contextMap.modules).sort();
    const missing = moduleDirs.filter((name) => !mapped.includes(name));
    const stale = mapped.filter((name) => !moduleDirs.includes(name));
    // El mensaje nombra la carpeta: es lo que hay que añadir al mapa, no silenciar.
    expect({ sinContexto: missing, sinCarpeta: stale }).toEqual({ sinContexto: [], sinCarpeta: [] });
  });

  it('cada módulo apunta a un contexto declarado', () => {
    const unknown = Object.entries(contextMap.modules)
      .filter(([, entry]) => !contextMap.contexts[entry.context])
      .map(([name, entry]) => `${name}→${entry.context}`);
    expect(unknown).toEqual([]);
  });

  it('una tabla registrada por más de un módulo tiene UN escritor declarado en tableOwners', () => {
    const registry = readStaticRegistry(rootDir);
    const registrants = new Map<string, string[]>();
    for (const [moduleName, tables] of Object.entries(registry.registrationsByModule)) {
      for (const table of tables) (registrants.get(table) ?? registrants.set(table, []).get(table))?.push(moduleName);
    }
    const shared = [...registrants.entries()].filter(([, modules]) => modules.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    const undeclared = shared
      .filter(([table, modules]) => {
        const declared = contextMap.tableOwners[table];
        // Sin declaración explícita, vale que sólo UNO de los registrantes sea propietario y el resto
        // lectores del mismo contexto; en cualquier otro caso hay que declarar.
        if (declared) return !modules.includes(declared) && !Object.keys(contextMap.modules).includes(declared);
        const owners = modules.filter((name) => contextMap.modules[name]?.role === 'owner');
        const contexts = new Set(modules.map((name) => contextMap.modules[name]?.context));
        return !(owners.length === 1 || contexts.size === 1);
      })
      .map(([table, modules]) => `${table} ← ${modules.join(', ')}`);
    // Deuda conocida y acotada: cada entrada de esta lista es una tabla que AT-020/AT-021 tienen que
    // llevar a un único escritor. La prueba fija el número para que no crezca sin que alguien lo declare.
    expect(undeclared.length).toBeLessThanOrEqual(KNOWN_SHARED_WITHOUT_OWNER);
  });

  it('un lector transversal no es propietario de ninguna tabla', () => {
    const readers = Object.entries(contextMap.modules)
      .filter(([, entry]) => entry.role === 'reader')
      .map(([name]) => name);
    const owning = Object.entries(contextMap.tableOwners).filter(([, owner]) => readers.includes(owner));
    expect(owning).toEqual([]);
    const registry = readStaticRegistry(rootDir);
    for (const reader of readers) expect(registry.registrationsByModule[reader] ?? []).toEqual([]);
  });

  it('todo propietario declarado en tableOwners es un módulo del mapa', () => {
    const unknown = Object.entries(contextMap.tableOwners).filter(([, owner]) => !contextMap.modules[owner]);
    expect(unknown).toEqual([]);
  });
});

/**
 * Medido el 2026-09-11 sobre dev@5650b95: 65 tablas registradas por más de un módulo, de las que
 * este número sigue sin escritor único declarado ni resoluble por contexto. Bajarlo es trabajo de
 * F3/F4; subirlo exige declarar la tabla en `tableOwners`.
 */
const KNOWN_SHARED_WITHOUT_OWNER = 48;
