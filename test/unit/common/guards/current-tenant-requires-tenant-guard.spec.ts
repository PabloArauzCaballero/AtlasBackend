import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { IS_PUBLIC_KEY } from '../../../../src/common/decorators/public.decorator.js';
import { TenantGuard } from '../../../../src/common/guards/tenant.guard.js';

/**
 * Quien lee el tenant de la petición tiene que comprobarlo contra el token.
 *
 * `@CurrentTenant()` resuelve el tenant PRIMERO desde la cabecera `x-tenant-id` y después desde el
 * token; `TenantGuard` es lo que exige que, si el token trae tenant, la cabecera coincida. Un
 * controlador que usa lo primero sin lo segundo deja que un interno del tenant A pida los datos del
 * tenant B poniendo la cabecera. El 2026-09-29 los cuatro controladores de `/expedientes` estaban
 * así (auditoría de la rama test, ATLAS-P1-009): tenían `@Roles` y `ExpedienteAccesoGuard`, pero el
 * nivel de acceso se calculaba con los roles del tenant del token y se aplicaba a los expedientes
 * del tenant de la cabecera. `check:auth-coverage` no lo ve: sólo mira que el fichero tenga algún
 * marcador de autorización.
 *
 * Esta prueba recorre TODOS los `*.controller.ts` de `src/modules`: si el fuente usa
 * `@CurrentTenant(`, la clase (o cada handler) tiene que declarar `TenantGuard` en `@UseGuards`.
 */
const ROOT = resolve(process.cwd(), 'src/modules');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out.sort();
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata('__guards__', target) as unknown[] | undefined) ?? [];
}

function isControllerClass(value: unknown): value is new (...args: never[]) => object {
  return typeof value === 'function' && Reflect.hasMetadata('path', value);
}

const usesCurrentTenant = controllerFiles(ROOT).filter((file) => /@CurrentTenant\(/.test(readFileSync(file, 'utf8')));

describe('todo controlador que usa @CurrentTenant() lleva TenantGuard', () => {
  it('la lista no está vacía (si lo estuviera, la prueba no vigilaría nada)', () => {
    expect(usesCurrentTenant.length).toBeGreaterThan(20);
  });

  it.each(usesCurrentTenant.map((file) => [relative(process.cwd(), file)]))('%s', (file) => {
    const mod = jest.requireActual(resolve(process.cwd(), file)) as Record<string, unknown>;
    const classes = Object.values(mod).filter(isControllerClass);
    expect(classes.length).toBeGreaterThan(0);
    for (const cls of classes) {
      // Los callbacks del Motor son `@Public()` respecto a la sesión: quien llama es un servicio con
      // clave propia, no una persona con token, y el tenant SÓLO puede venir por cabecera. Ahí
      // `TenantGuard` no tiene contra qué comparar; lo que se exige es que no estén abiertos: algún
      // guard de servicio en la clase.
      if (Reflect.getMetadata(IS_PUBLIC_KEY, cls) === true) {
        const fuente = readFileSync(resolve(process.cwd(), file), 'utf8');
        const conClave = guardsOf(cls).length > 0 || /assertEngineCallbackKey\(/.test(fuente);
        expect({ controlador: cls.name, exigeClaveDeServicio: conClave }).toEqual({ controlador: cls.name, exigeClaveDeServicio: true });
        continue;
      }
      const classHasIt = guardsOf(cls).includes(TenantGuard);
      if (classHasIt) continue;
      // Si no está en la clase, tiene que estar en CADA handler que la clase expone.
      const handlers = Object.getOwnPropertyNames(cls.prototype).filter(
        (name) => name !== 'constructor' && Reflect.hasMetadata('path', cls.prototype[name as keyof object] as object),
      );
      const sinGuard = handlers.filter((name) => !guardsOf(cls.prototype[name as keyof object] as object).includes(TenantGuard));
      expect({ controlador: cls.name, handlersSinTenantGuard: sinGuard }).toEqual({ controlador: cls.name, handlersSinTenantGuard: [] });
    }
  });
});
