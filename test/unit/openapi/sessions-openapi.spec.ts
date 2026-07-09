import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomerSessionsController, OperationsSessionsController } from '../../../src/modules/sessions/sessions.controller.js';
import { SessionsService } from '../../../src/modules/sessions/sessions.service.js';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';

/**
 * ATLAS-OPENAPI: `sessions` es el primer módulo del retrofit con DOS controllers compartiendo
 * el mismo `SwaggerModule` — valida que no haya colisión de rutas/params entre
 * `CustomerSessionsController` (`/customers/:customerId/...`) y `OperationsSessionsController`
 * (`/operations/sessions/...`), y que cada `@ApiParam` declarado coincida con el token real de
 * la ruta (Nest lanza en tiempo de generación si no coinciden).
 */
describe('sessions — OpenAPI document generation (2 controllers)', () => {
  async function buildDocument() {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerSessionsController, OperationsSessionsController],
      providers: [
        {
          provide: SessionsService,
          useValue: {
            startSession: jest.fn(),
            heartbeat: jest.fn(),
            endSession: jest.fn(),
            getSessionState: jest.fn(),
            getOperationsSessionSummary: jest.fn(),
          },
        },
      ],
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

  it('documents both controllers without path/param collisions', async () => {
    const document = await buildDocument();
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/customers/{customerId}/sessions/start',
        '/customers/{customerId}/sessions/{sessionId}/heartbeat',
        '/customers/{customerId}/sessions/{sessionId}/end',
        '/customers/{customerId}/session-state',
        '/operations/sessions/{sessionId}/investigation-summary',
      ]),
    );
  });

  it('derives the startSession body schema (device fingerprint requirements) from Zod', async () => {
    const document = await buildDocument();
    const body = document.paths['/customers/{customerId}/sessions/start']?.post?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    const deviceSchema = (body.content['application/json'].schema.properties as Record<string, Record<string, unknown>>).device;
    expect(deviceSchema.type).toBe('object');
  });
});
