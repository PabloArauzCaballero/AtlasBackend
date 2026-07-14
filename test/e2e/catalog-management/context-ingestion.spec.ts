import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TenantGuard } from '../../../src/common/guards/tenant.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import { env } from '../../../src/config/env.js';
import { CatalogManagementController } from '../../../src/modules/catalog-management/catalog-management.controller.js';
import { CatalogManagementService } from '../../../src/modules/catalog-management/catalog-management.service.js';

describe('CatalogManagementController ingestion (e2e/supertest)', () => {
  let app: INestApplication;
  const service = {
    ingestCatalog: jest.fn(async () => ({ ingestionJobId: '91', status: 'completed', stagingItemsCreated: 1 })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogManagementController],
      providers: [
        JwtAuthGuard,
        TenantGuard,
        RolesGuard,
        { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
        { provide: CatalogManagementService, useValue: service },
      ],
    }).compile();
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    expressApp.useBodyParser('json', { limit: env.API_JSON_BODY_LIMIT });
    expressApp.useBodyParser('urlencoded', { limit: env.API_JSON_BODY_LIMIT, extended: true });
    app = expressApp;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function authorization(): string {
    const token = jwt.sign({ sub: 'context-seed-e2e', role: 'system' }, env.JWT_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    return `Bearer ${token}`;
  }

  const validBody = {
    catalogCode: 'socioeconomic.market_access_context',
    sourceType: 'governed_reference_context',
    sourceName: 'ATLAS Multidomain Context Definitive 1.2M',
    sourceCode: 'ATLAS_GOVERNED_CONTEXT_V2',
    items: [
      {
        rawValue: 'AD.02 | FORMAL_REGULATED.ACCESS_LOW',
        normalizedValue: 'CTX01.AD.02.FORMAL_REGULATED.ACCESS_LOW',
        itemType: 'context_binding',
        confidenceScore: '78.00',
        rawPayload: { publicationScope: 'preproduction_reference' },
        aiSuggested: false,
      },
    ],
  };

  it('exige X-Idempotency-Key antes de delegar la ingesta', async () => {
    await request(app.getHttpServer())
      .post('/operations/catalog-ingestions')
      .set('Authorization', authorization())
      .set('x-tenant-id', '1')
      .send(validBody)
      .expect(400);

    expect(service.ingestCatalog).not.toHaveBeenCalled();
  });

  it('propaga la clave de idempotencia y el payload validado', async () => {
    const response = await request(app.getHttpServer())
      .post('/operations/catalog-ingestions')
      .set('Authorization', authorization())
      .set('x-tenant-id', '1')
      .set('x-idempotency-key', 'context-seed-chunk-001')
      .send(validBody)
      .expect(201);

    expect(response.body).toEqual({ ingestionJobId: '91', status: 'completed', stagingItemsCreated: 1 });
    expect(service.ingestCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        body: validBody,
        context: expect.objectContaining({ tenantId: '1', idempotencyKey: 'context-seed-chunk-001' }),
      }),
    );
  });

  it('rechaza lotes HTTP mayores al contrato de 1000 items', async () => {
    await request(app.getHttpServer())
      .post('/operations/catalog-ingestions')
      .set('Authorization', authorization())
      .set('x-tenant-id', '1')
      .set('x-idempotency-key', 'oversized')
      .send({ ...validBody, items: Array.from({ length: 1_001 }, () => validBody.items[0]) })
      .expect(400);

    expect(service.ingestCatalog).not.toHaveBeenCalled();
  });
});
