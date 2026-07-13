import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { CatalogManagementController } from '../../../src/modules/catalog-management/catalog-management.controller.js';
import { CatalogManagementService } from '../../../src/modules/catalog-management/catalog-management.service.js';

describe('catalog-management — OpenAPI del contexto de decisión', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogManagementController],
      providers: [{ provide: CatalogManagementService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('test').build());
    await app.close();
  });

  it('documenta todos los filtros reales de catálogos', () => {
    const names = document.paths['/operations/catalogs']?.get?.parameters?.map((parameter) =>
      '$ref' in parameter ? parameter.$ref : parameter.name,
    );
    expect(names).toEqual(expect.arrayContaining(['domain', 'status', 'active']));
  });

  it('expone la estructura de catálogo, versión, items y mapeos de riesgo', () => {
    const response = document.paths['/operations/catalogs/{catalogCode}/versions/{versionId}']?.get?.responses?.['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    const properties = response.content['application/json'].schema.properties as Record<string, unknown>;
    expect(properties).toEqual(
      expect.objectContaining({ catalog: expect.any(Object), version: expect.any(Object), items: expect.any(Object) }),
    );
  });

  it('expone las cuatro familias de definiciones semánticas', () => {
    const response = document.paths['/operations/definitions']?.get?.responses?.['200'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
    };
    expect(response.content['application/json'].schema.properties).toEqual(
      expect.objectContaining({
        observations: expect.any(Object),
        events: expect.any(Object),
        attributes: expect.any(Object),
        features: expect.any(Object),
      }),
    );
  });

  it('documenta 422, no 409, para estados inválidos del workflow', () => {
    const responses = document.paths['/operations/catalogs/{catalogCode}/versions/{versionId}/decision']?.post?.responses;
    expect(responses?.['422']).toBeDefined();
    expect(responses?.['409']).toBeUndefined();
  });
});
