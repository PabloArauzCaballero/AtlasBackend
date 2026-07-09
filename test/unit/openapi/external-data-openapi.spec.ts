import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  AdminExternalProvidersController,
  BureauExternalDataController,
  DigitalTrustExternalDataController,
  ExternalDataController,
  FacebookExternalDataController,
  KycExternalDataController,
  PaymentsExternalDataController,
  TelcoExternalDataController,
  WhatsappExternalDataController,
} from '../../../src/modules/external-data/external-data.controller.js';
import { ExternalDataService } from '../../../src/modules/external-data/external-data.service.js';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';

/**
 * ATLAS-OPENAPI: `external-data` es el módulo con más controllers (9) y más endpoints (~40) del
 * proyecto. Este test genera el documento completo con los 9 controllers juntos — el caso más
 * exigente para detectar colisiones de nombre de operación/param entre controllers montados en
 * prefijos de ruta distintos (`external-data`, `admin/external-providers`, `kyc`, `bureau`,
 * `payments`, `telco`, `social/facebook`, `whatsapp`, `digital-trust`).
 */
describe('external-data — OpenAPI document generation (9 controllers, ~40 endpoints)', () => {
  let document: OpenAPIObject;

  async function buildDocument() {
    const serviceMock = {
      activateProviderKillSwitch: jest.fn(),
      approveRequest: jest.fn(),
      auditExternalProvidersQuality: jest.fn(),
      auditIdempotencyKeys: jest.fn(),
      auditResponseSanitization: jest.fn(),
      createConsent: jest.fn(),
      createFacebookConnectUrl: jest.fn(),
      executeBankTransfer: jest.fn(),
      executeDigitalTrust: jest.fn(),
      executeExternalDataRequest: jest.fn(),
      executeFacebookCallback: jest.fn(),
      executeInfocenter: jest.fn(),
      executeQrPayment: jest.fn(),
      executeSegip: jest.fn(),
      executeTelcoPhoneTrust: jest.fn(),
      executeWhatsapp: jest.fn(),
      getCustomerDecisionPackage: jest.fn(),
      getCustomerFeatures: jest.fn(),
      getCustomerObservations: jest.fn(),
      getCustomerScoringInput: jest.fn(),
      getProductionGate: jest.fn(),
      getProviderCostPolicies: jest.fn(),
      getProviderHealth: jest.fn(),
      getProviderReadiness: jest.fn(),
      getProviderRequest: jest.fn(),
      getProviderSlaReport: jest.fn(),
      getProviderUsage: jest.fn(),
      getRetentionPreview: jest.fn(),
      listCustomerConsents: jest.fn(),
      listProviders: jest.fn(),
      previewExternalDataRequest: jest.fn(),
      rebuildFeatureSnapshotFromRequest: jest.fn(),
      retryProviderRequest: jest.fn(),
      revokeConsent: jest.fn(),
      updateProviderCostPolicy: jest.fn(),
      updateProviderRuntimePolicy: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ExternalDataController,
        AdminExternalProvidersController,
        KycExternalDataController,
        BureauExternalDataController,
        PaymentsExternalDataController,
        TelcoExternalDataController,
        FacebookExternalDataController,
        WhatsappExternalDataController,
        DigitalTrustExternalDataController,
      ],
      providers: [{ provide: ExternalDataService, useValue: serviceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    const config = new DocumentBuilder().setTitle('Atlas API Test').setVersion('test').build();
    const doc = SwaggerModule.createDocument(app, config);
    await app.close();
    return doc;
  }

  beforeAll(async () => {
    document = await buildDocument();
  }, 30_000);

  it('documents a representative sample of paths across all 9 controllers without collisions', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/external-data/requests',
        '/admin/external-providers/{providerCode}/runtime',
        '/kyc/segip/verify',
        '/bureau/infocenter/check',
        '/payments/qr/verify',
        '/telco/phone-trust/verify',
        '/social/facebook/status/{customerId}',
        '/whatsapp/status/{customerId}',
        '/digital-trust/profile/{customerId}',
      ]),
    );
  });

  it('every operation across all 9 controllers has a summary (no gaps left in the retrofit)', () => {
    let total = 0;
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, { summary?: string }>)) {
        total += 1;
        if (!operation.summary) throw new Error(`${method.toUpperCase()} ${path} is missing @ApiOperation summary`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(39);
  });

  it('derives the executeRequest body schema (providerCode enum, queryType, etc.) from Zod', () => {
    const body = document.paths['/external-data/requests']?.post?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect((body.content['application/json'].schema.properties as Record<string, unknown>).providerCode).toBeDefined();
  });
});
