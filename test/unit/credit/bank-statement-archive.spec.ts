import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BankStatementArchiveService,
  BANK_STATEMENT_ARCHIVE_LIMIT,
} from '../../../src/modules/credit/application/bank-statement-archive.service.js';
import { BankStatementArchiveController } from '../../../src/modules/credit/bank-statement-archive.controller.js';
import { toBankStatementArchiveResponse } from '../../../src/modules/credit/bank-statement.mapper.js';
import { bankStatementFileName } from '../../../src/modules/credit/domain/bank-statement-file-name.js';

/**
 * «Mis datos» enseña los extractos que el cliente subió y le deja descargarlos. Lo que estas pruebas
 * sostienen es que el archivo sólo sale para su dueño: la revisión se busca por cliente y la clave del
 * almacén tiene que colgar de su prefijo, las dos cosas.
 */
const PDF = Buffer.from('%PDF-1.7 extracto');

function revision(extra: Record<string, unknown> = {}) {
  return {
    id: '7',
    tenantId: '1',
    customerId: '10',
    status: 'applied',
    storageKey: '1/10/bank_statement/abc.pdf',
    createdAtValue: new Date('2026-09-14T15:30:00.000Z'),
    promisedBy: new Date('2026-09-15T15:30:00.000Z'),
    appliedCreditLineId: '3',
    rejectionReason: null,
    rejectionCategory: null,
    institutionName: 'Banco Unión',
    periodFrom: '2026-06-01',
    periodTo: '2026-08-31',
    affordabilityJson: null,
    reviewReason: null,
    ...extra,
  };
}

function build(found: ReturnType<typeof revision> | null = revision(), objeto: Buffer | null = PDF) {
  const reviews = {
    findAll: jest.fn(async (..._args: unknown[]) => (found ? [found] : [])),
    findOne: jest.fn(async (..._args: unknown[]) => found),
  };
  const storage = { readObject: jest.fn(async (..._args: unknown[]) => objeto) };
  const service = new BankStatementArchiveService(reviews as never, storage as never);
  return { service, reviews, storage };
}

describe('BankStatementArchiveService · los extractos del cliente', () => {
  it('lista sólo los suyos, del más reciente al más antiguo y con tope', async () => {
    const { service, reviews } = build();
    await service.list('1', '10');
    expect(reviews.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: '1', customerId: '10', deleted: false },
        order: [['_created_at', 'DESC']],
        limit: BANK_STATEMENT_ARCHIVE_LIMIT,
      }),
    );
  });

  it('devuelve el PDF tal y como está en el almacén, con el nombre de la fecha de subida', async () => {
    const { service, reviews, storage } = build();
    await expect(service.file('1', '10', '7')).resolves.toEqual({ pdf: PDF, fileName: 'extracto-2026-09-14.pdf' });
    expect(reviews.findOne).toHaveBeenCalledWith({ where: { id: '7', tenantId: '1', customerId: '10', deleted: false } });
    expect(storage.readObject).toHaveBeenCalledWith('1/10/bank_statement/abc.pdf');
  });

  it('una revisión que no es de ese cliente no existe, y no se toca el almacén', async () => {
    const { service, storage } = build(null);
    await expect(service.file('1', '10', '7')).rejects.toThrow('BANK_STATEMENT_NOT_FOUND');
    await expect(service.file('1', '10', '7')).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.readObject).not.toHaveBeenCalled();
  });

  it('una fila suya con la clave de OTRO cliente no se sirve', async () => {
    const { service, storage } = build(revision({ storageKey: '1/99/bank_statement/ajeno.pdf' }));
    await expect(service.file('1', '10', '7')).rejects.toThrow('BANK_STATEMENT_FILE_NOT_AVAILABLE');
    expect(storage.readObject).not.toHaveBeenCalled();
  });

  it.each([
    ['sin clave de almacén', revision({ storageKey: null }), PDF],
    ['con el archivo ya retirado del almacén', revision(), null],
  ])('%s responde que el archivo no está disponible, no un fallo', async (_caso, fila, objeto) => {
    const { service } = build(fila, objeto);
    await expect(service.file('1', '10', '7')).rejects.toThrow('BANK_STATEMENT_FILE_NOT_AVAILABLE');
  });
});

describe('toBankStatementArchiveResponse · lo que lee «Mis datos»', () => {
  it('cada extracto lleva su estado y si se puede descargar, sin la clave del almacén', () => {
    const respuesta = toBankStatementArchiveResponse([revision(), revision({ id: '8', storageKey: null })] as never);
    expect(respuesta.items).toHaveLength(2);
    expect(respuesta.items[0]).toMatchObject({
      reviewId: '7',
      status: 'applied',
      institutionName: 'Banco Unión',
      period: { from: '2026-06-01', to: '2026-08-31' },
      file: { available: true, fileName: 'extracto-2026-09-14.pdf' },
    });
    expect(respuesta.items[1]?.file.available).toBe(false);
    expect(JSON.stringify(respuesta)).not.toContain('bank_statement/abc.pdf');
  });

  it('sin fecha legible, el nombre usa el id de la revisión', () => {
    expect(bankStatementFileName({ id: '7', createdAtValue: null })).toBe('extracto-7.pdf');
    expect(bankStatementFileName({ id: '7', createdAtValue: 'no es una fecha' })).toBe('extracto-7.pdf');
  });
});

describe('BankStatementArchiveController · de quién es', () => {
  const cliente = (customerId: string) => ({ userId: 'u1', role: 'customer', customerId, tenantId: '1' }) as never;

  function controlador() {
    const archive = {
      list: jest.fn(async (..._args: unknown[]) => [revision()]),
      file: jest.fn(async (..._args: unknown[]) => ({ pdf: PDF, fileName: 'extracto-2026-09-14.pdf' })),
    };
    return { controller: new BankStatementArchiveController(archive as never), archive };
  }

  it('otro cliente no puede listar ni descargar: 403 antes de consultar nada', async () => {
    const { controller, archive } = controlador();
    await expect(controller.list('1', { customerId: '10' }, cliente('11'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.file('1', { customerId: '10', reviewId: '7' }, cliente('11'), {} as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(archive.list).not.toHaveBeenCalled();
    expect(archive.file).not.toHaveBeenCalled();
  });

  it('el dueño recibe el PDF en línea, con su tamaño y sin que nadie lo guarde en caché', async () => {
    const { controller } = controlador();
    const cabeceras: Record<string, string> = {};
    const end = jest.fn();
    const response = { setHeader: (nombre: string, valor: string) => (cabeceras[nombre] = valor), end };
    await controller.file('1', { customerId: '10', reviewId: '7' }, cliente('10'), response as never);
    expect(cabeceras).toEqual({
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="extracto-2026-09-14.pdf"',
      'content-length': String(PDF.length),
      'cache-control': 'private, no-store',
    });
    expect(end).toHaveBeenCalledWith(PDF);
  });
});
