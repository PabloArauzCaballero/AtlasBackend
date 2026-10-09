import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CreditDownPaymentService } from '../../../src/modules/credit/application/credit-down-payment.service.js';

type Fila = Record<string, unknown> & { save: () => Promise<void> };

function solicitud(extra: Record<string, unknown> = {}): Fila {
  return {
    id: '70',
    tenantId: '1',
    customerId: '9',
    partnerProfileId: '5',
    posTerminalId: null,
    status: 'approved',
    applicationCode: 'CA-70',
    currencyCode: 'BOB',
    // Financiado (40 %) de una compra de Bs 250: el inicial (60 %) es Bs 150, el `amount` de `cuerpo`.
    requestedAmount: '100.00',
    businessAcceptance: 'accepted',
    downPaymentStatus: null,
    downPaymentAmount: null,
    downPaymentSubmittedAt: null,
    downPaymentDecidedAt: null,
    downPaymentRejectionReason: null,
    downPaymentProofEvidenceId: null,
    downPaymentPayerReference: null,
    save: jest.fn(async () => undefined),
    ...extra,
  } as Fila;
}

function build(app: Fila | null, opciones: { objeto?: unknown; imagenYaSubida?: boolean } = {}) {
  const sequelize = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn({ LOCK: { UPDATE: 'UPDATE' } }) };
  const applications = { findOne: jest.fn(async () => app), findAll: jest.fn(async () => (app ? [app] : [])) };
  const events = { create: jest.fn(async (..._a: unknown[]) => ({})) };
  const evidences = {
    create: jest.fn(async () => ({ id: '300' })),
    // Por huella: ¿ya subió el cliente esta misma imagen? Por id: el comprobante que se descarga.
    findOne: jest.fn(async (consulta: { where: Record<string, unknown> }) =>
      'fileHashSha256' in consulta.where
        ? opciones.imagenYaSubida
          ? { id: '12', documentType: 'bank_qr_proof' }
          : null
        : { s3Key: 'k/proof.jpg', mimeType: 'image/jpeg' },
    ),
  };
  const storage = {
    readObjectMetadata: jest.fn(async () => ('objeto' in opciones ? opciones.objeto : { sha256Hex: 'a'.repeat(64), sizeBytes: 1234 })),
    getBucket: () => 'bucket',
    readObject: jest.fn(async () => Buffer.from('img')),
  };
  const partners = { requireProfile: jest.fn(async () => ({ ownerMerchantUserId: '77' })) };
  const directory = { terminalDirectory: jest.fn(async () => new Map()) };
  const service = new CreditDownPaymentService(
    sequelize as never,
    applications as never,
    events as never,
    evidences as never,
    storage as never,
    partners as never,
    directory as never,
  );
  return { service, applications, events, evidences, storage };
}

const cliente = { role: 'customer', customerId: '9', sub: 'u9' } as never;
const comercio = { role: 'merchant', sub: '77', merchantUserId: '77' } as never;
const cuerpo = {
  amount: '150.00',
  payerReference: 'OP-4839201',
  storageKey: '1/customer-9/proof-abc.jpg',
  contentType: 'image/jpeg',
};

describe('CreditDownPaymentService.submit', () => {
  it('avisa el pago inicial: guarda el comprobante, deja la solicitud en «submitted» y escribe el evento', async () => {
    const app = solicitud();
    const { service, evidences, events } = build(app);

    const r = await service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente });

    expect(r).toMatchObject({ applicationId: '70', downPaymentStatus: 'submitted', downPaymentAmount: '150.00' });
    expect(evidences.create).toHaveBeenCalledTimes(1);
    expect(app.downPaymentProofEvidenceId).toBe('300');
    expect(app.downPaymentPayerReference).toBe('OP-4839201');
    expect(events.create).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'down_payment_submitted' }), expect.anything());
  });

  it('una imagen que el cliente ya subió no es comprobante: lo dice con su código, sin violar el índice único', async () => {
    const app = solicitud();
    const { service, evidences } = build(app, { imagenYaSubida: true });
    const error = await service
      .submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'PAYMENT_PROOF_ALREADY_USED',
      message: expect.stringMatching(/ya la subiste antes/),
    });
    expect(evidences.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: '1', customerId: '9', fileHashSha256: 'a'.repeat(64) } }),
    );
    expect(evidences.create).not.toHaveBeenCalled();
    expect(app.downPaymentStatus).not.toBe('submitted');
  });

  it('no deja avisar antes de que el comercio acepte la venta: antes no hay a quién pagarle', async () => {
    const { service, evidences } = build(solicitud({ businessAcceptance: 'pending' }));
    await expect(
      service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente }),
    ).rejects.toThrow(/DOWN_PAYMENT_NOT_ALLOWED_YET/);
    expect(evidences.create).not.toHaveBeenCalled();
  });

  it('un aviso en espera o ya confirmado no se repite; uno rechazado sí', async () => {
    for (const estado of ['submitted', 'confirmed']) {
      const { service } = build(solicitud({ downPaymentStatus: estado }));
      await expect(
        service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente }),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    const rechazado = solicitud({ downPaymentStatus: 'rejected', downPaymentRejectionReason: 'No llegó' });
    const { service } = build(rechazado);
    await service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente });
    expect(rechazado.downPaymentStatus).toBe('submitted');
    expect(rechazado.downPaymentRejectionReason).toBeNull();
  });

  it('una solicitud ajena es indistinguible de una inexistente', async () => {
    const { service } = build(null);
    await expect(
      service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('otro cliente no puede avisar en nombre del dueño', async () => {
    const { service } = build(solicitud());
    await expect(
      service.submit({
        tenantId: '1',
        customerId: '9',
        applicationId: '70',
        body: cuerpo,
        currentUser: { role: 'customer', customerId: '10', sub: 'u10' } as never,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin comercio no hay aviso: nadie lo confirmaría', async () => {
    const { service } = build(solicitud({ partnerProfileId: null }));
    await expect(
      service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente }),
    ).rejects.toThrow(/APPLICATION_WITHOUT_PARTNER/);
  });

  it('APP-04: un importe que no es el inicial de la compra se rechaza con 422 y dice cuál es, sin tocar nada', async () => {
    const app = solicitud();
    const { service, evidences, storage } = build(app);
    const error = await service
      .submit({ tenantId: '1', customerId: '9', applicationId: '70', body: { ...cuerpo, amount: '1.00' }, currentUser: cliente })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'DOWN_PAYMENT_AMOUNT_MISMATCH',
      expectedAmount: '150.00',
      currencyCode: 'BOB',
    });
    // Se rechaza ANTES de mirar el almacén o crear el comprobante.
    expect(storage.readObjectMetadata).not.toHaveBeenCalled();
    expect(evidences.create).not.toHaveBeenCalled();
    expect(app.downPaymentStatus).toBeNull();
  });

  it('APP-04: tampoco vale pagar DE MÁS ni cero', async () => {
    for (const [amount, code] of [
      ['150.02', 'DOWN_PAYMENT_AMOUNT_MISMATCH'],
      ['250.00', 'DOWN_PAYMENT_AMOUNT_MISMATCH'],
      ['0', 'DOWN_PAYMENT_AMOUNT_INVALID'],
      ['0.00', 'DOWN_PAYMENT_AMOUNT_INVALID'],
    ] as const) {
      const { service } = build(solicitud());
      const error = await service
        .submit({ tenantId: '1', customerId: '9', applicationId: '70', body: { ...cuerpo, amount }, currentUser: cliente })
        .catch((e: unknown) => e);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code });
    }
  });

  it('APP-04: sin financiado no hay de dónde calcular el inicial, y no se acepta ninguno', async () => {
    const { service } = build(solicitud({ requestedAmount: '0.00' }));
    const error = await service
      .submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente })
      .catch((e: unknown) => e);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'DOWN_PAYMENT_EXPECTED_UNKNOWN',
      expectedAmount: null,
    });
  });

  it('APP-04: guarda el importe normalizado a dos decimales', async () => {
    const app = solicitud();
    const { service } = build(app);
    const r = await service.submit({
      tenantId: '1',
      customerId: '9',
      applicationId: '70',
      body: { ...cuerpo, amount: '150' },
      currentUser: cliente,
    });
    expect(r).toMatchObject({ downPaymentAmount: '150.00', expectedDownPaymentAmount: '150.00' });
  });

  it('si el objeto no está en el almacén no se cree el aviso', async () => {
    const { service } = build(solicitud(), { objeto: null });
    await expect(
      service.submit({ tenantId: '1', customerId: '9', applicationId: '70', body: cuerpo, currentUser: cliente }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('CreditDownPaymentService.decide', () => {
  it('el comercio confirma: queda «confirmed» con quién y cuándo', async () => {
    const app = solicitud({ downPaymentStatus: 'submitted', downPaymentAmount: '150.00' });
    const { service, events } = build(app);
    const r = await service.decide({
      tenantId: '1',
      partnerProfileId: '5',
      applicationId: '70',
      body: { verified: true },
      currentUser: comercio,
    });
    expect(r.downPaymentStatus).toBe('confirmed');
    expect(app.downPaymentDecidedBy).toBe('77');
    expect(events.create).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'down_payment_confirmed' }), expect.anything());
  });

  it('rechazar guarda el motivo que verá el cliente', async () => {
    const app = solicitud({ downPaymentStatus: 'submitted' });
    const { service } = build(app);
    const r = await service.decide({
      tenantId: '1',
      partnerProfileId: '5',
      applicationId: '70',
      body: { verified: false, reason: 'No veo la transferencia' },
      currentUser: comercio,
    });
    expect(r).toMatchObject({ downPaymentStatus: 'rejected', rejectionReason: 'No veo la transferencia' });
  });

  it('APP-04: el comercio no confirma un aviso cuyo importe no es el inicial de la compra (aviso viejo o alterado)', async () => {
    const app = solicitud({ downPaymentStatus: 'submitted', downPaymentAmount: '10.00' });
    const { service, events } = build(app);
    await expect(
      service.decide({ tenantId: '1', partnerProfileId: '5', applicationId: '70', body: { verified: true }, currentUser: comercio }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(app.downPaymentStatus).toBe('submitted');
    expect(events.create).not.toHaveBeenCalled();
    // Rechazarlo sí se puede: así el cliente vuelve a avisar con el importe correcto.
    const r = await service.decide({
      tenantId: '1',
      partnerProfileId: '5',
      applicationId: '70',
      body: { verified: false, reason: 'El importe no es el inicial' },
      currentUser: comercio,
    });
    expect(r.downPaymentStatus).toBe('rejected');
  });

  it('sólo se decide lo que está en espera', async () => {
    const { service } = build(solicitud({ downPaymentStatus: 'confirmed' }));
    await expect(
      service.decide({ tenantId: '1', partnerProfileId: '5', applicationId: '70', body: { verified: true }, currentUser: comercio }),
    ).rejects.toThrow(/DOWN_PAYMENT_NOT_PENDING/);
  });

  it('un comercio no decide sobre una compra que nació en otro', async () => {
    const { service } = build(solicitud({ downPaymentStatus: 'submitted', partnerProfileId: '6' }));
    await expect(
      service.decide({ tenantId: '1', partnerProfileId: '5', applicationId: '70', body: { verified: true }, currentUser: comercio }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CreditDownPaymentService.listForPartner / readProof', () => {
  it('lista los pagos iniciales del comercio con su importe y si tienen comprobante', async () => {
    const { service } = build(
      solicitud({
        downPaymentStatus: 'submitted',
        downPaymentAmount: '150.00',
        downPaymentProofEvidenceId: '300',
        downPaymentSubmittedAt: new Date('2026-10-07T12:00:00Z'),
      }),
    );
    const r = await service.listForPartner({ tenantId: '1', partnerProfileId: '5', onlyPending: true, currentUser: comercio });
    expect(r.downPayments).toHaveLength(1);
    expect(r.downPayments[0]).toMatchObject({
      applicationId: '70',
      downPaymentStatus: 'submitted',
      downPaymentAmount: '150.00',
      hasProof: true,
    });
  });

  it('sirve los bytes del comprobante sólo al dueño', async () => {
    const { service } = build(solicitud({ downPaymentStatus: 'submitted', downPaymentProofEvidenceId: '300' }));
    const imagen = await service.readProof({ tenantId: '1', partnerProfileId: '5', applicationId: '70', currentUser: comercio });
    expect(imagen.contentType).toBe('image/jpeg');
    expect(imagen.bytes.toString()).toBe('img');
  });

  it('sin comprobante responde 404 en vez de una imagen vacía', async () => {
    const { service } = build(solicitud({ downPaymentStatus: 'submitted' }));
    await expect(service.readProof({ tenantId: '1', partnerProfileId: '5', applicationId: '70', currentUser: comercio })).rejects.toThrow(
      /DOWN_PAYMENT_WITHOUT_PROOF/,
    );
  });
});
