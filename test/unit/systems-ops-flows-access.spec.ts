import { Reflector } from '@nestjs/core';
import { INTERNAL_PERMISSIONS_KEY } from '../../src/modules/internal-users/internal-permissions.decorator.js';
import { SystemFlowsController } from '../../src/modules/systems-ops/system-flows.controller.js';

/**
 * Flujos publica el mapa completo de Atlas: rutas de los cuatro bloques, quién puede llamarlas, qué
 * tablas escriben y qué hallazgos abiertos hay. El catálogo de RBAC prometía desde el primer día que
 * `systems/flows/*` exige `systems.flows.read`, el permiso estaba sembrado y el menú del portal ya lo
 * usaba para decidir si enseñar la sección… y el backend sólo comprobaba el ROL, que es grueso:
 * `SYSTEMS_OPS_ROLES` incluye a qa_engineer, devops y risk_analyst.
 *
 * O sea: la propia herramienta afirmaba algo sobre Atlas que no era verdad. Esto lo fija.
 */
const reflector = new Reflector();

const metodosDeLectura = [
  'summary',
  'businessFlows',
  'modules',
  'list',
  'screens',
  'findings',
  'imports',
  'moduleGraph',
  'flowGraph',
  'detail',
] as const;

const metodosDeEscritura = ['verify', 'importEndpoints', 'importScreens', 'importFindings'] as const;

const permisoDe = (metodo: string): string[] | undefined =>
  reflector.get<string[]>(INTERNAL_PERMISSIONS_KEY, (SystemFlowsController.prototype as unknown as Record<string, () => unknown>)[metodo]);

describe('SystemFlowsController · el permiso fino que el catálogo promete', () => {
  it.each(metodosDeLectura)('%s exige systems.flows.read', (metodo) => {
    expect(permisoDe(metodo)).toEqual(['systems.flows.read']);
  });

  it.each(metodosDeEscritura)('%s exige systems.flows.analyze, que es otro permiso', (metodo) => {
    // Leer el mapa y REGENERARLO no son la misma autoridad: quien consulta no debería poder
    // reescribir el catálogo ni lanzar una verificación contra otro bloque.
    expect(permisoDe(metodo)).toEqual(['systems.flows.analyze']);
  });

  it('ningún método del controlador se queda sin permiso declarado', () => {
    // El fallo que esto evita es el de omisión: añadir un endpoint nuevo y olvidar el decorador
    // deja una ruta que sólo comprueba el rol, sin que nada se ponga rojo.
    const metodos = Object.getOwnPropertyNames(SystemFlowsController.prototype).filter((nombre) => nombre !== 'constructor');
    const sinPermiso = metodos.filter((metodo) => !permisoDe(metodo));
    expect(sinPermiso).toEqual([]);
  });

  it('el guard de permisos corre DESPUÉS de los de sesión, no antes', () => {
    // Sin el guard, los decoradores son metadatos decorativos: declaran el permiso y no lo exigen.
    // Y el ORDEN importa: los decoradores de clase se aplican de abajo arriba y `UseGuards` extiende
    // el array, así que es fácil dejar el de permisos primero. Preguntar por el permiso de alguien a
    // quien aún no se ha identificado devuelve «requiere una sesión interna» a un usuario válido.
    // Hoy lo tapa que Jwt y Roles sean además globales; esta prueba impide depender de eso.
    const guards = (reflector.get<Array<{ name: string }>>('__guards__', SystemFlowsController) ?? []).map((g) => g.name);
    expect(guards).toContain('InternalPermissionsGuard');
    expect(guards.indexOf('InternalPermissionsGuard')).toBe(guards.length - 1);
    expect(guards[0]).toBe('JwtAuthGuard');
  });
});
