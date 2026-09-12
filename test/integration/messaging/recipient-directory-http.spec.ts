/**
 * @file AT-057 — el directorio de destinatarios por HTTP: Clientes lo sirve con identidad de servicio y el
 *   worker de Mensajería lo consume sin leer tablas ajenas.
 * @business El piloto obtiene direcciones vigentes autorizadas por el propósito, del tenant de SU token, y
 *   nada más: sin token, con token de usuario, de otro servicio o de otro contexto → 401; un propósito no
 *   autorizado → vacío; un fallo de red → «no entregable», nunca una dirección inventada.
 * @system Nest real con `CustomerRecipientDirectoryController`, `ServiceTokenGuard` y el adaptador de Clientes
 *   sobre PostgreSQL (contacto cifrado real); `HttpRecipientDirectoryAdapter` apunta al servidor levantado en
 *   un puerto efímero.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { ServiceTokenGuard } from '../../../src/common/guards/service-token.guard.js';
import { encryptSecretEnvelope } from '../../../src/common/utils/crypto/envelope-encryption.util.js';
import { hashSensitiveText, lastCharacters } from '../../../src/common/utils/crypto/hash.util.js';
import { env } from '../../../src/config/env.js';
import { CustomerContactMethodModel } from '../../../src/database/models/index.js';
import { CustomerRecipientDirectoryController } from '../../../src/modules/customers/customer-recipient-directory.controller.js';
import { CustomerRecipientDirectoryAdapter } from '../../../src/modules/customers/infrastructure/customer-recipient-directory.adapter.js';
import { CustomerContactsRepository } from '../../../src/modules/customers/repositories/customer-contacts.repository.js';
import { HttpRecipientDirectoryAdapter } from '../../../src/modules/notifications/infrastructure/directory/http-recipient-directory.adapter.js';
import { resourceFingerprint, signServiceToken } from '../../../src/platform/security/service-token.js';
import { buildAdmissionHarness, type AdmissionHarness } from '../credit/support/admission-harness.js';
import { openIntegrationDatabase, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let harness: AdmissionHarness | null = null;
let app: INestApplication | null = null;
let baseUrl = '';
let customerId = '';
const PHONE = '+59170000123';

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (!database) return;
  harness = await buildAdmissionHarness(database.sequelize);
  customerId = await harness.createCustomer('active');
  const contacts = new CustomerContactsRepository(CustomerContactMethodModel);
  const contact = await contacts.createContactMethod(
    {
      tenantId: harness.tenantId,
      customerId,
      contactType: 'phone',
      contactValueHash: hashSensitiveText(PHONE),
      contactValueEncrypted: await encryptSecretEnvelope(PHONE),
      valueLast4: lastCharacters(PHONE, 4),
      emailDomain: null,
      isPrimary: true,
      sourceType: 'test',
      createdAt: new Date(),
    },
    {},
  );
  await contact.update({ status: 'verified' });
  const moduleRef = await Test.createTestingModule({
    controllers: [CustomerRecipientDirectoryController],
    providers: [ServiceTokenGuard, { provide: CustomerContactsRepository, useValue: contacts }, CustomerRecipientDirectoryAdapter],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
  if (harness) await CustomerContactMethodModel.destroy({ where: { tenantId: harness.tenantId } });
  await harness?.cleanup();
  await database?.close();
});

const scope = 'customers:recipient-directory';
const directory = () => new HttpRecipientDirectoryAdapter({ baseUrl, service: 'messaging-worker', scope, timeoutMs: 2000 });

describe('AT-057 · directorio de destinatarios por HTTP', () => {
  it('el worker obtiene la dirección vigente del tenant de su token, autorizada por el propósito', async () => {
    if (!harness) return;
    const lookup = { tenantId: harness.tenantId, recipient: { type: 'customer' as const, id: customerId }, channel: 'sms' as const };
    expect(await directory().resolve(lookup)).toMatchObject({ status: 'available' });
    const addresses = await directory().resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' });
    expect(addresses.map((address) => ({ kind: address.kind, address: address.address }))).toEqual([{ kind: 'phone', address: PHONE }]);
    expect(await directory().resolveDeliveryAddresses({ ...lookup, purpose: 'marketing' })).toEqual([]);
  });

  it('otro tenant en el token: el cliente no existe para ese tenant (sin fuga cruzada)', async () => {
    if (!harness) return;
    const addresses = await directory().resolveDeliveryAddresses({
      tenantId: String(Number(harness.tenantId) + 1),
      recipient: { type: 'customer', id: customerId },
      channel: 'sms',
      purpose: 'transactional',
    });
    expect(addresses).toEqual([]);
  });

  it('sin token, token de usuario, servicio ajeno u otro contexto → 401; la cabecera x-tenant-id no manda', async () => {
    if (!harness) return;
    const path = `/internal/contexts/customers/recipient-directory/addresses?customerId=${customerId}&channel=sms&purpose=transactional`;
    const server = app!.getHttpServer();
    expect((await request(server).get(path)).status).toBe(401);
    const user = jwt.sign({ sub: 'u', role: 'admin', tenantId: harness.tenantId }, env.JWT_ACCESS_TOKEN_SECRET, {
      algorithm: 'HS256',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    expect((await request(server).get(path).set('Authorization', `Bearer ${user}`)).status).toBe(401);
    const stranger = signServiceToken({
      service: 'credit-worker',
      tenantId: harness.tenantId,
      scopes: [scope],
      audienceContext: 'customers',
    });
    expect((await request(server).get(path).set('Authorization', `Bearer ${stranger}`)).status).toBe(401);
    const otherContext = signServiceToken({
      service: 'messaging-worker',
      tenantId: harness.tenantId,
      scopes: [scope],
      audienceContext: 'credit',
    });
    expect((await request(server).get(path).set('Authorization', `Bearer ${otherContext}`)).status).toBe(401);
    // Un token válido pero SIN la huella del recurso tampoco entra: la ruta la exige (hallazgo A7).
    const withoutResource = signServiceToken({
      service: 'messaging-worker',
      tenantId: harness.tenantId,
      scopes: [scope],
      audienceContext: 'customers',
    });
    expect((await request(server).get(path).set('Authorization', `Bearer ${withoutResource}`)).status).toBe(401);
    // Y uno firmado para OTRO cliente no sirve para leer este.
    const forAnotherCustomer = signServiceToken({
      service: 'messaging-worker',
      tenantId: harness.tenantId,
      scopes: [scope],
      audienceContext: 'customers',
      resource: resourceFingerprint({ customerId: '999999', channel: 'sms', purpose: 'transactional' }),
    });
    expect((await request(server).get(path).set('Authorization', `Bearer ${forAnotherCustomer}`)).status).toBe(401);
    const good = signServiceToken({
      service: 'messaging-worker',
      tenantId: harness.tenantId,
      scopes: [scope],
      audienceContext: 'customers',
      resource: resourceFingerprint({ customerId, channel: 'sms', purpose: 'transactional' }),
    });
    const response = await request(server).get(path).set('Authorization', `Bearer ${good}`).set('x-tenant-id', '999999');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain(PHONE);
  });

  it('fallo de red o servicio caído: no entregable (unsupported / vacío), sin excepción hacia el orquestador', async () => {
    if (!harness) return;
    const down = new HttpRecipientDirectoryAdapter({ baseUrl: 'http://127.0.0.1:1', service: 'messaging-worker', scope, timeoutMs: 1000 });
    const lookup = { tenantId: harness.tenantId, recipient: { type: 'customer' as const, id: customerId }, channel: 'sms' as const };
    expect((await down.resolve(lookup)).status).toBe('unsupported');
    expect(await down.resolveDeliveryAddresses({ ...lookup, purpose: 'transactional' })).toEqual([]);
  });
});
