import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthController } from '../../../src/modules/auth/auth.controller.js';
import { AuthService } from '../../../src/modules/auth/auth.service.js';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';

/**
 * ATLAS-OPENAPI: valida que los decoradores Swagger agregados a `AuthController` producen un
 * documento OpenAPI real y detallado — sin necesitar levantar el `AppModule` completo (que
 * requiere una conexión real a PostgreSQL, ver `scripts/generate-openapi.ts`). Monta solo el
 * controller con un `AuthService` mockeado y un guard permisivo, y genera el documento con el
 * mismo `SwaggerModule.createDocument` que usa `buildOpenApiDocument` en producción.
 */
describe('AuthController — OpenAPI document generation', () => {
  async function buildDocument() {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn(), provisionCredentials: jest.fn() } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const config = new DocumentBuilder().setTitle('Atlas API Test').setVersion('test').build();
    const document = SwaggerModule.createDocument(app, config);
    await app.close();
    return document;
  }

  it('documents all 4 auth endpoints under the /auth prefix', async () => {
    const document = await buildDocument();
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/provision-credentials']),
    );
  });

  it('derives the login request body schema from loginSchema — actorType enum and identifier/password constraints appear', async () => {
    const document = await buildDocument();
    const loginBody = document.paths['/auth/login']?.post?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    const schema = loginBody.content['application/json'].schema;
    expect(schema.properties).toMatchObject({
      actorType: { enum: ['customer', 'internal_user', 'platform_user'] },
      identifier: { type: 'string', minLength: 3, maxLength: 180 },
      password: { type: 'string', minLength: 1, maxLength: 128 },
    });
    expect(schema.required).toEqual(expect.arrayContaining(['actorType', 'identifier', 'password']));
  });

  it('documents the 401/403/409 error responses for provision-credentials, not just the happy path', async () => {
    const document = await buildDocument();
    const responses = document.paths['/auth/provision-credentials']?.post?.responses ?? {};
    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['201', '401', '403', '409']));
  });

  it('every operation has a human-readable summary (no endpoint left with an auto-generated/empty one)', async () => {
    const document = await buildDocument();
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, { summary?: string }>)) {
        if (!operation.summary) throw new Error(`${method.toUpperCase()} ${path} is missing @ApiOperation summary`);
      }
    }
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
  });
});
