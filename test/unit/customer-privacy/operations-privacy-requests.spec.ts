import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { INTERNAL_PERMISSIONS_KEY } from '../../../src/modules/internal-users/internal-permissions.decorator.js';
import { OperationsPrivacyRequestsController } from '../../../src/modules/customer-privacy/operations-privacy-requests.controller.js';
import {
  operationsPrivacyRequestsQuerySchema,
  privacyRequestTransitionSchema,
} from '../../../src/modules/customer-privacy/operations-privacy-requests.schemas.js';
import {
  OperationsPrivacyRequestsService,
  resumenDeSombra,
} from '../../../src/modules/customer-privacy/operations-privacy-requests.service.js';

/**
 * La cola interna de solicitudes del titular (hallazgo A5). Se fija lo que se equivoca en silencio:
 * un filtro que no llega al SQL, un «vencida» calculado con el reloj equivocado, una transición que
 * escribe sin bloquear la fila o sin auditoría, y un cierre que deja la solicitud sin responsable.
 */
const AHORA = new Date('2026-09-27T12:00:00.000Z');

function fila(over: Record<string, unknown> = {}) {
  return {
    requestId: '5',
    requestCode: 'DSR-5',
    requestType: 'access',
    status: 'received',
    receivedAt: new Date('2026-09-01T12:00:00.000Z'),
    resolvedAt: null,
    resolutionNotes: null,
    handledByInternalUserId: null,
    handledByName: null,
    customerId: '9',
    customerCode: 'C-9',
    customerName: 'Ana Pérez',
    ...over,
  };
}

function montar(opciones: { filas?: Record<string, unknown>[]; solicitud?: Record<string, unknown> | null } = {}) {
  const filas = opciones.filas ?? [fila()];
  const query = jest.fn(async (sql: string, _o: { bind: Record<string, unknown> }) => {
    if (sql.includes('FILTER')) return [{ open: '3', overdue: '2' }];
    if (sql.includes('COUNT(*)::text AS total')) return [{ total: String(filas.length) }];
    if (sql.includes('operational_audit_logs'))
      return [
        {
          actionCode: 'privacy.data_subject_request.create',
          occurredAt: new Date('2026-09-01T12:00:00.000Z'),
          actorType: 'customer',
          actorInternalUserId: null,
          actorName: null,
          payload: { customerId: '9', requestType: 'access' },
        },
        {
          actionCode: 'privacy.data_subject_request.transition',
          occurredAt: new Date('2026-09-02T12:00:00.000Z'),
          actorType: 'compliance_analyst',
          actorInternalUserId: '77',
          actorName: 'Carla Cumplimiento',
          payload: { fromStatus: 'received', toStatus: 'in_progress', reason: null },
        },
      ];
    return filas;
  });
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = { query, transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(transaction)) };
  const solicitud = opciones.solicitud === undefined ? { status: 'received', customerId: '9', resolutionNotes: null } : opciones.solicitud;
  const repository = {
    findDataSubjectRequestForUpdate: jest.fn(async (..._args: unknown[]) => solicitud),
    updateDataSubjectRequest: jest.fn(async (..._args: unknown[]) => solicitud),
    createAudit: jest.fn(async (..._args: unknown[]) => ({})),
  };
  const service = new OperationsPrivacyRequestsService(repository as never, sequelize as never);
  return { service, query, repository, sequelize };
}

const consulta = (over: Record<string, unknown> = {}) => operationsPrivacyRequestsQuerySchema.parse(over);
const interno = { role: 'compliance_analyst', internalUserId: '77', platformUserId: null } as never;

describe('OperationsPrivacyRequestsService.list', () => {
  it('pagina, resume toda la cola y calcula vencimiento a 15 días desde la recepción', async () => {
    const { service } = montar();
    const result = await service.list('1', consulta(), AHORA);
    expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(result.summary).toEqual({
      open: 3,
      overdue: 2,
      dueDays: 15,
      shadow: { compared: 0, agreed: 0, agreement: null, falseAccept: 0, handedToPerson: 0, gaveUp: 0, stale: 0 },
    });
    expect(result.items[0]).toMatchObject({
      requestId: '5',
      receivedAt: '2026-09-01T12:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      overdue: true,
      daysToDue: -11,
      customerName: 'Ana Pérez',
    });
  });

  it('una cerrada no está vencida ni cuenta días', async () => {
    const { service } = montar({ filas: [fila({ status: 'completed', resolvedAt: new Date('2026-09-20T00:00:00.000Z') })] });
    const [item] = (await service.list('1', consulta(), AHORA)).items;
    expect(item).toMatchObject({ overdue: false, daysToDue: null, resolvedAt: '2026-09-20T00:00:00.000Z' });
  });

  it('cada filtro llega al SQL con bind, y overdue=false NIEGA el criterio de vencida', async () => {
    const { service, query } = montar();
    await service.list(
      '1',
      consulta({ status: 'in_progress', type: 'erasure', customerId: '9', overdue: 'false', page: '2', pageSize: '10' }),
      AHORA,
    );
    const [sql, opciones] = query.mock.calls[0]!;
    expect(sql).toContain('d.status = $status');
    expect(sql).toContain('d.request_type = $type');
    expect(sql).toContain('d.customer_id = $customerId');
    expect(sql).toContain("NOT (d.status IN ('received', 'in_progress') AND COALESCE(d.requested_at, d._created_at) < $overdueCutoff)");
    expect(opciones.bind).toMatchObject({ tenantId: '1', status: 'in_progress', type: 'erasure', customerId: '9', limit: 10, offset: 10 });
    expect((opciones.bind.overdueCutoff as Date).toISOString()).toBe('2026-09-12T12:00:00.000Z');
  });

  it('q busca por parte en el código de la solicitud y del cliente, y el CONTEO lleva el join al cliente', async () => {
    const { service, query } = montar();
    await service.list('1', consulta({ q: 'DSR_1' }), AHORA);
    const [sql, opciones] = query.mock.calls[0]!;
    expect(sql).toContain('(d.request_code ILIKE $q OR cu.customer_code ILIKE $q)');
    expect(opciones.bind.q).toBe('%DSR\\_1%');
    const conteo = query.mock.calls.find(([texto]) => texto.includes('COUNT(*)::text AS total'))!;
    expect(conteo[0]).toContain('LEFT JOIN');
    expect(conteo[0]).toContain('$q');
  });

  it('PRUEBA EN NEGATIVO — z.coerce no convierte «false» en true', () => {
    expect(consulta({ overdue: 'false' }).overdue).toBe('false');
    expect(() => consulta({ overdue: 'si' })).toThrow();
  });
});

describe('OperationsPrivacyRequestsService.detail', () => {
  it('devuelve transiciones admitidas e historial desde la auditoría', async () => {
    const { service } = montar();
    const detalle = await service.detail('1', '5', AHORA);
    expect(detalle.allowedTransitions).toEqual(['in_progress']);
    expect(detalle.history).toEqual([
      expect.objectContaining({ action: 'created', toStatus: 'received', actorType: 'customer' }),
      expect.objectContaining({ action: 'transition', fromStatus: 'received', toStatus: 'in_progress', actorName: 'Carla Cumplimiento' }),
    ]);
  });

  it('404 si no existe en el tenant', async () => {
    const { service } = montar({ filas: [] });
    await expect(service.detail('1', '404', AHORA)).rejects.toThrow(NotFoundException);
  });
});

describe('OperationsPrivacyRequestsService.detail · lo que pidió la persona', () => {
  async function conValor(valor: string) {
    const { encryptSecretEnvelope } = await import('../../../src/common/utils/crypto/envelope-encryption.util.js');
    return fila({
      requestType: 'rectification',
      description: 'mi zona está mal',
      rectificationField: 'zone',
      hasProposedValue: true,
      pinVerifiedAt: new Date('2026-09-01T11:58:00.000Z'),
      proposedValueEnvelope: await encryptSecretEnvelope(valor),
    });
  }

  it('enseña el texto, el campo y el valor propuesto DESCIFRADO a quien mira, y audita esa lectura', async () => {
    const { service, repository } = montar({ filas: [await conValor('Equipetrol')] });

    const detalle = await service.detail('1', '5', AHORA, { currentUser: interno, ipAddress: '10.0.0.1' });

    expect(detalle).toMatchObject({ description: 'mi zona está mal', rectificationField: 'zone', proposedValue: 'Equipetrol' });
    expect(detalle.pinVerifiedAt).toBe('2026-09-01T11:58:00.000Z');
    const auditoria = (repository.createAudit as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(auditoria).toMatchObject({
      actionCode: 'privacy.data_subject_request.proposed_value_read',
      actorInternalUserId: '77',
      targetId: '5',
    });
    // La auditoría dice QUIÉN lo vio y de qué campo; el valor no (la auditoría no se cifra).
    expect(JSON.stringify(auditoria)).not.toContain('Equipetrol');
  });

  it('NUNCA devuelve el sobre cifrado tal cual', async () => {
    const { service } = montar({ filas: [await conValor('Equipetrol')] });
    const detalle = await service.detail('1', '5', AHORA, { currentUser: interno, ipAddress: null });
    expect(detalle).not.toHaveProperty('proposedValueEnvelope');
  });

  it('sin lector identificado no revela el valor ni deja lectura auditada', async () => {
    const { service, repository } = montar({ filas: [await conValor('Equipetrol')] });
    const detalle = await service.detail('1', '5', AHORA);
    expect(detalle.proposedValue).toBeNull();
    expect(repository.createAudit).not.toHaveBeenCalled();
  });

  it('un sobre ilegible no tumba el detalle: el valor sale vacío y no se audita una lectura que no ocurrió', async () => {
    const { service, repository } = montar({
      filas: [fila({ rectificationField: 'zone', hasProposedValue: true, proposedValueEnvelope: 'v2:roto' })],
    });
    const detalle = await service.detail('1', '5', AHORA, { currentUser: interno, ipAddress: null });
    expect(detalle.proposedValue).toBeNull();
    expect(repository.createAudit).not.toHaveBeenCalled();
  });

  it('el listado NO pide el sobre cifrado; el detalle sí', async () => {
    const { service, query } = montar();
    await service.list('1', consulta(), AHORA);
    const sqlListado = query.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('"customerName"')) ?? '';
    expect(sqlListado).not.toContain('proposedValueEnvelope');
    query.mockClear();
    await service.detail('1', '5', AHORA);
    const sqlDetalle = query.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('"customerName"')) ?? '';
    expect(sqlDetalle).toContain('proposedValueEnvelope');
  });
});

describe('OperationsPrivacyRequestsService.transition', () => {
  it('tomarla bloquea la fila, la asigna a quien la toma y deja auditoría', async () => {
    const { service, repository } = montar();
    await service.transition({
      tenantId: '1',
      requestId: '5',
      dto: { toStatus: 'in_progress' },
      currentUser: interno,
      ipAddress: '10.0.0.1',
      now: AHORA,
    });
    expect(repository.findDataSubjectRequestForUpdate).toHaveBeenCalledWith('1', '5', { transaction: expect.anything() });
    expect(repository.updateDataSubjectRequest).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'in_progress', handledBy: '77', resolvedAt: null, resolutionNotes: null, updatedAt: AHORA },
      expect.anything(),
    );
    expect(repository.createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: 'privacy.data_subject_request.transition',
        targetType: 'data_subject_request',
        targetId: '5',
        actorInternalUserId: '77',
        payload: { fromStatus: 'received', toStatus: 'in_progress', reason: null, customerId: '9' },
      }),
      expect.anything(),
    );
  });

  it('cerrarla fecha el cierre y guarda el motivo como notas de resolución', async () => {
    const { service, repository } = montar({ solicitud: { status: 'in_progress', customerId: '9', resolutionNotes: null } });
    await service.transition({
      tenantId: '1',
      requestId: '5',
      dto: { toStatus: 'completed', reason: 'Copia de datos entregada por correo.' },
      currentUser: interno,
      ipAddress: null,
      now: AHORA,
    });
    expect(repository.updateDataSubjectRequest).toHaveBeenCalledWith(
      expect.anything(),
      {
        status: 'completed',
        handledBy: '77',
        resolvedAt: AHORA,
        resolutionNotes: 'Copia de datos entregada por correo.',
        updatedAt: AHORA,
      },
      expect.anything(),
    );
  });

  it('409 ante un salto no permitido y 422 al cerrar sin motivo, sin escribir nada', async () => {
    const a = montar();
    await expect(
      a.service.transition({
        tenantId: '1',
        requestId: '5',
        dto: { toStatus: 'completed', reason: 'Motivo suficiente.' },
        currentUser: interno,
        ipAddress: null,
        now: AHORA,
      }),
    ).rejects.toThrow(ConflictException);
    const b = montar({ solicitud: { status: 'in_progress', customerId: '9', resolutionNotes: null } });
    await expect(
      b.service.transition({
        tenantId: '1',
        requestId: '5',
        dto: { toStatus: 'rejected' },
        currentUser: interno,
        ipAddress: null,
        now: AHORA,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(a.repository.updateDataSubjectRequest).not.toHaveBeenCalled();
    expect(b.repository.createAudit).not.toHaveBeenCalled();
  });

  it('404 si no existe o está borrada; 403 sin sesión interna', async () => {
    await expect(
      montar({ solicitud: null }).service.transition({
        tenantId: '1',
        requestId: '5',
        dto: { toStatus: 'in_progress' },
        currentUser: interno,
        ipAddress: null,
        now: AHORA,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      montar({ solicitud: { status: 'received', deleted: true } }).service.transition({
        tenantId: '1',
        requestId: '5',
        dto: { toStatus: 'in_progress' },
        currentUser: interno,
        ipAddress: null,
        now: AHORA,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      montar().service.transition({
        tenantId: '1',
        requestId: '5',
        dto: { toStatus: 'in_progress' },
        currentUser: { role: 'admin' } as never,
        ipAddress: null,
        now: AHORA,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el esquema rechaza un motivo de menos de 10 caracteres y un destino desconocido', () => {
    expect(() => privacyRequestTransitionSchema.parse({ toStatus: 'completed', reason: 'corto' })).toThrow();
    expect(() => privacyRequestTransitionSchema.parse({ toStatus: 'received' })).toThrow();
  });
});

describe('OperationsPrivacyRequestsController', () => {
  const proto = OperationsPrivacyRequestsController.prototype;
  it('leer exige privacy.requests.read y mover exige privacy.requests.manage', () => {
    expect(Reflect.getMetadata(INTERNAL_PERMISSIONS_KEY, proto.list)).toEqual(['privacy.requests.read']);
    expect(Reflect.getMetadata(INTERNAL_PERMISSIONS_KEY, proto.detail)).toEqual(['privacy.requests.read']);
    expect(Reflect.getMetadata(INTERNAL_PERMISSIONS_KEY, proto.transition)).toEqual(['privacy.requests.manage']);
  });

  it('PRUEBA EN NEGATIVO — el cliente no entra a la cola interna', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OperationsPrivacyRequestsController) as string[];
    expect(roles).not.toContain('customer');
    expect(roles).toContain('compliance_analyst');
  });

  it('delega en el servicio con tenant, id, cuerpo, actor e ip', async () => {
    const service = { list: jest.fn(), detail: jest.fn(), transition: jest.fn() };
    const controller = new OperationsPrivacyRequestsController(service as never);
    await controller.list('1', consulta());
    await controller.detail('1', { requestId: '5' }, interno, { ip: '10.0.0.1' } as never);
    await controller.transition('1', { requestId: '5' }, { toStatus: 'in_progress' }, interno, { ip: '10.0.0.1' });
    expect(service.list).toHaveBeenCalledWith('1', expect.objectContaining({ page: 1 }));
    // Quién mira viaja al servicio: la lectura del valor propuesto se audita con su autor.
    expect(service.detail).toHaveBeenCalledWith('1', '5', expect.any(Date), { currentUser: interno, ipAddress: '10.0.0.1' });
    expect(service.transition).toHaveBeenCalledWith({
      tenantId: '1',
      requestId: '5',
      dto: { toStatus: 'in_progress' },
      currentUser: interno,
      ipAddress: '10.0.0.1',
    });
  });
});

describe('resumenDeSombra', () => {
  it('el acuerdo es sobre lo comparado; sin nada comparado es null y no 100 %', () => {
    expect(resumenDeSombra(undefined).agreement).toBeNull();
    expect(resumenDeSombra({ open: '0', overdue: '0', shadowCompared: '40', shadowAgreed: '38', shadowFalseAccept: '1' })).toMatchObject({
      compared: 40,
      agreed: 38,
      agreement: 0.95,
      falseAccept: 1,
    });
  });

  it('las que el Motor no llegó a opinar salen aparte: rendidas y atrasadas', () => {
    expect(resumenDeSombra({ open: '5', overdue: '0', shadowGaveUp: '2', shadowStale: '3' })).toMatchObject({ gaveUp: 2, stale: 3 });
  });
});
