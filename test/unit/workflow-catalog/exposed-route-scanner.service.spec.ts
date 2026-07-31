import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Public } from '../../../src/common/decorators/public.decorator.js';
import { Roles } from '../../../src/common/decorators/roles.decorator.js';
import { ExposedRouteScannerService } from '../../../src/modules/workflow-catalog/application/exposed-route-scanner.service.js';

@Controller('fixture')
@Roles('internal_operator')
class FixtureController {
  @Get('leer')
  read(): string {
    return 'ok';
  }

  @Public()
  @Post('publico')
  publicWrite(): string {
    return 'ok';
  }

  @Roles('admin', 'platform_admin')
  @Get(':id/detalle')
  detail(): string {
    return 'ok';
  }

  /** Sin decorador de ruta: es un helper del controlador, no un endpoint. */
  helper(): string {
    return 'no es una ruta';
  }
}

@Controller()
class RootController {
  @Get('raiz')
  root(): string {
    return 'ok';
  }
}

@Module({ imports: [DiscoveryModule], controllers: [FixtureController, RootController], providers: [ExposedRouteScannerService] })
class FixtureModule {}

/**
 * El escáner responde "qué rutas quedaron montadas en ESTE proceso", que es distinto de "qué hay
 * escrito en el repositorio". Por eso se prueba contra un módulo Nest real y no contra archivos.
 */
describe('ExposedRouteScannerService', () => {
  let moduleRef: TestingModule;
  let routes: ReturnType<ExposedRouteScannerService['scan']>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    await moduleRef.init();
    routes = moduleRef.get(ExposedRouteScannerService).scan();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('descubre una entrada por handler decorado con un método HTTP', () => {
    expect(routes.map((route) => `${route.method} ${route.routePath}`).sort()).toEqual([
      'GET /fixture/:id/detalle',
      'GET /fixture/leer',
      'GET /raiz',
      'POST /fixture/publico',
    ]);
  });

  it('ignora los métodos del controlador que no son rutas', () => {
    expect(routes.some((route) => route.handlerName === 'helper')).toBe(false);
  });

  it('compone la ruta del prefijo del controlador y del handler', () => {
    expect(routes.find((route) => route.handlerName === 'detail')?.routePath).toBe('/fixture/:id/detalle');
  });

  it('un controlador sin prefijo produce rutas de primer nivel', () => {
    expect(routes.find((route) => route.handlerName === 'root')?.routePath).toBe('/raiz');
  });

  it('hereda los roles de la clase cuando el handler no los declara', () => {
    expect(routes.find((route) => route.handlerName === 'read')?.roles).toEqual(['internal_operator']);
  });

  it('los roles del handler reemplazan a los de la clase, no se suman', () => {
    expect(routes.find((route) => route.handlerName === 'detail')?.roles).toEqual(['admin', 'platform_admin']);
  });

  it('marca como público el handler con @Public()', () => {
    const publicRoute = routes.find((route) => route.handlerName === 'publicWrite');
    expect(publicRoute).toMatchObject({ isPublic: true, method: 'POST' });
  });

  it('devuelve el nombre del controlador y del handler para poder señalar el origen', () => {
    expect(routes.find((route) => route.handlerName === 'read')?.controllerName).toBe('FixtureController');
  });
});
