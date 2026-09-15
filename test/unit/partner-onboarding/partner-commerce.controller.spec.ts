import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PartnerCommerceController } from '../../../src/modules/partner-onboarding/partner-commerce.controller.js';
import type { PartnerCommerceService } from '../../../src/modules/partner-onboarding/application/partner-commerce.service.js';
import type { PartnerQrService } from '../../../src/modules/partner-onboarding/application/partner-qr.service.js';

/**
 * Lo que el comercio opera de su propio expediente: locales, QR de cobro y cajas.
 *
 * Tres decisiones que sólo se ven en el borde HTTP.
 *
 * La lista de QR publica sólo el PREFIJO del hash: identifica el archivo en una traza sin publicarlo
 * entero. Pero el prefijo prueba que el archivo existe y no deja comprobar que sea el QR correcto,
 * y un comercio que sube la imagen equivocada no se entera hasta que un cliente transfiere a la
 * cuenta de otro. De ahí la ruta que sirve los BYTES.
 *
 * Y esos bytes se sirven, no se firma una URL del almacenamiento: un enlace firmado funciona sin
 * sesión mientras no venza, y aquí cada lectura pasa por el token, el rol y el guard de propiedad
 * igual que el resto del módulo.
 *
 * El identificador del comercio sale SIEMPRE del parámetro de ruta —el que el guard de propiedad ya
 * validó— y nunca del cuerpo, que es donde se colaría cualquiera.
 */
describe('PartnerCommerceController', () => {
  let commerce: {
    registerBranch: jest.Mock;
    linkBranchToErp: jest.Mock;
    listBranches: jest.Mock;
    registerPosTerminal: jest.Mock;
    listPosTerminals: jest.Mock;
    changePosStatus: jest.Mock;
  };
  let qr: { createUploadTicket: jest.Mock; register: jest.Mock; list: jest.Mock; readQrImage: jest.Mock };
  let controller: PartnerCommerceController;

  const sucursal = {
    id: 'b-1',
    branchCode: 'SUC-01',
    name: 'Centro',
    addressLine: null,
    city: null,
    latitude: '-17.78',
    longitude: '-63.18',
    status: 'active',
    erpBranchId: null,
  };
  const codigoQr = {
    id: 'qr-1',
    qrKind: 'payment',
    branchId: null,
    sha256: 'abcdef0123456789abcdef',
    contentType: 'image/png',
    sizeBytes: 1024,
    bankInstitutionCode: 'BNB',
    accountNumberMasked: '****4321',
    status: 'pending_review',
    verifiedAt: null,
    replacedById: null,
    createdAtValue: new Date('2026-09-01T10:00:00Z'),
  };
  const terminal = {
    id: 'pos-1',
    branchId: 'b-1',
    terminalSerial: 'SN-123',
    terminalAlias: null,
    provider: null,
    model: null,
    status: 'registered',
    activatedAt: null,
    lastSeenAt: null,
  };

  beforeEach(() => {
    commerce = {
      registerBranch: jest.fn(async () => sucursal),
      linkBranchToErp: jest.fn(async () => ({ ...sucursal, erpBranchId: 'erp-9' })),
      listBranches: jest.fn(async () => [sucursal]),
      registerPosTerminal: jest.fn(async () => terminal),
      listPosTerminals: jest.fn(async () => [terminal]),
      changePosStatus: jest.fn(async () => ({ ...terminal, status: 'suspended' })),
    };
    qr = {
      createUploadTicket: jest.fn(async () => ({ ticketId: 'tk-1', url: 'https://minio/put', headers: {} })),
      register: jest.fn(async () => codigoQr),
      list: jest.fn(async () => [codigoQr]),
      readQrImage: jest.fn(async () => ({ contentType: 'image/png', bytes: Buffer.from('png') })),
    };
    controller = new PartnerCommerceController(commerce as unknown as PartnerCommerceService, qr as unknown as PartnerQrService);
  });

  describe('sucursales', () => {
    it('registrar delega con el comercio del PARÁMETRO de ruta, no con lo que venga en el cuerpo', async () => {
      await controller.registerBranch(
        't1',
        { partnerId: 'pp-1' } as never,
        { branchCode: 'SUC-01', name: 'Centro', partnerId: 'pp-ajeno' } as never,
      );

      expect(commerce.registerBranch).toHaveBeenCalledWith('t1', 'pp-1', expect.objectContaining({ branchCode: 'SUC-01' }));
    });

    it('la respuesta sale mapeada, con las coordenadas como número y no como texto', async () => {
      const dto = await controller.registerBranch('t1', { partnerId: 'pp-1' } as never, { branchCode: 'SUC-01' } as never);

      expect(dto).toMatchObject({ branchId: 'b-1', branchCode: 'SUC-01', latitude: -17.78, longitude: -63.18 });
    });

    it('una sucursal sin coordenadas las declara nulas y no NaN', async () => {
      commerce.registerBranch.mockResolvedValueOnce({ ...sucursal, latitude: null, longitude: null } as never);

      const dto = await controller.registerBranch('t1', { partnerId: 'pp-1' } as never, {} as never);

      expect(dto.latitude).toBeNull();
      expect(dto.longitude).toBeNull();
    });

    it('enlazar con el ERP lleva los DOS identificadores de ruta y devuelve el enlace ya hecho', async () => {
      const dto = await controller.linkBranch('t1', { partnerId: 'pp-1', branchId: 'b-1' } as never, { erpBranchId: 'erp-9' } as never);

      expect(commerce.linkBranchToErp).toHaveBeenCalledWith('t1', 'pp-1', 'b-1', { erpBranchId: 'erp-9' });
      expect(dto.erpBranchId).toBe('erp-9');
    });

    it('el listado sale mapeado, no con las filas crudas', async () => {
      const lista = await controller.listBranches('t1', { partnerId: 'pp-1' } as never);

      expect(lista).toHaveLength(1);
      expect(lista[0]).toHaveProperty('branchId');
      expect(lista[0]).not.toHaveProperty('id');
    });
  });

  describe('códigos QR', () => {
    it('el permiso de subida lo emite el servicio con el cuerpo entero: es él quien impone la ruta', async () => {
      const ticket = await controller.createQrUploadUrl(
        't1',
        { partnerId: 'pp-1' } as never,
        { qrKind: 'payment', contentType: 'image/png', sizeBytes: 1024 } as never,
      );

      expect(qr.createUploadTicket).toHaveBeenCalledWith('t1', 'pp-1', { qrKind: 'payment', contentType: 'image/png', sizeBytes: 1024 });
      expect(ticket).toMatchObject({ ticketId: 'tk-1' });
    });

    it('un QR registrado sale con SÓLO el prefijo del hash, nunca el hash entero', async () => {
      const dto = await controller.registerQr('t1', { partnerId: 'pp-1' } as never, { qrKind: 'payment' } as never);

      expect(dto.fingerprint).toBe('abcdef012345');
      expect(dto.fingerprint).toHaveLength(12);
      expect(JSON.stringify(dto)).not.toContain(codigoQr.sha256);
    });

    it('nace en revisión y sin fecha de verificación', async () => {
      const dto = await controller.registerQr('t1', { partnerId: 'pp-1' } as never, {} as never);

      expect(dto.status).toBe('pending_review');
      expect(dto.verifiedAt).toBeNull();
    });

    it('el listado también recorta el hash de cada uno', async () => {
      const lista = await controller.listQr('t1', { partnerId: 'pp-1' } as never);

      expect(lista[0].fingerprint).toHaveLength(12);
    });

    it('los BYTES se sirven por la API y no como una URL firmada que funcionaría sin sesión', async () => {
      const cabeceras: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => (cabeceras[k] = v) } as unknown as Response;

      const archivo = await controller.qrContent('t1', { partnerId: 'pp-1' } as never, 'qr-1', res);

      expect(archivo).toBeInstanceOf(StreamableFile);
      expect(cabeceras['Content-Type']).toBe('image/png');
      expect(qr.readQrImage).toHaveBeenCalledWith('t1', 'pp-1', 'qr-1');
    });

    it('el tipo del contenido lo dice el objeto guardado, no la extensión ni el cliente', async () => {
      qr.readQrImage.mockResolvedValueOnce({ contentType: 'image/jpeg', bytes: Buffer.from('jpg') } as never);
      const cabeceras: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => (cabeceras[k] = v) } as unknown as Response;

      await controller.qrContent('t1', { partnerId: 'pp-1' } as never, 'qr-1', res);

      expect(cabeceras['Content-Type']).toBe('image/jpeg');
    });
  });

  describe('terminales', () => {
    it('registrar cuelga el terminal de la sucursal de la ruta', async () => {
      const dto = await controller.registerPos(
        't1',
        { partnerId: 'pp-1', branchId: 'b-1' } as never,
        { terminalSerial: 'SN-123' } as never,
      );

      expect(commerce.registerPosTerminal).toHaveBeenCalledWith('t1', 'pp-1', 'b-1', { terminalSerial: 'SN-123' });
      expect(dto).toMatchObject({ terminalId: 'pos-1', status: 'registered', activatedAt: null });
    });

    it('el listado sale mapeado y sin la fila cruda', async () => {
      const lista = await controller.listPos('t1', { partnerId: 'pp-1' } as never);

      expect(lista[0]).toHaveProperty('terminalSerial', 'SN-123');
      expect(lista[0]).not.toHaveProperty('id');
    });

    it('cambiar el estado se hace sobre el terminal de la ruta y devuelve el estado nuevo', async () => {
      const dto = await controller.changePosStatus(
        't1',
        { partnerId: 'pp-1', terminalId: 'pos-1' } as never,
        { status: 'suspended' } as never,
      );

      expect(commerce.changePosStatus).toHaveBeenCalledWith('t1', 'pp-1', 'pos-1', { status: 'suspended' });
      expect(dto.status).toBe('suspended');
    });

    it('un terminal activado declara su fecha en ISO', async () => {
      commerce.changePosStatus.mockResolvedValueOnce({
        ...terminal,
        status: 'active',
        activatedAt: new Date('2026-09-05T10:00:00Z'),
      } as never);

      const dto = await controller.changePosStatus(
        't1',
        { partnerId: 'pp-1', terminalId: 'pos-1' } as never,
        { status: 'active' } as never,
      );

      expect(dto.activatedAt).toBe('2026-09-05T10:00:00.000Z');
    });
  });
});
