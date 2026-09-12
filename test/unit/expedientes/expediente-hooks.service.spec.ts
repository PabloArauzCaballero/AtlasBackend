import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExpedienteHooksService } from '../../../src/modules/expedientes/application/expediente-hooks.service.js';
import { env } from '../../../src/config/env.js';
import type { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import type { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import type { MaterializadorService } from '../../../src/modules/expedientes/application/materializador.service.js';
import type { ActorService } from '../../../src/modules/expedientes/application/actor.service.js';
import type { DocumentStorageService } from '../../../src/common/storage/document-storage.service.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * Los ganchos del alta.
 *
 * La regla que se fija por encima de todas: NINGÚN fallo de aquí puede subir. El expediente es una
 * VISTA de archivos que ya se guardaron por su propio camino —la evidencia va a
 * `evidence_documents` y al almacén se escriba o no el catálogo—, así que tumbar un alta, con una
 * persona esperando con el teléfono en la mano, porque no se pudo crear una carpeta sería cambiar
 * un problema cosmético por uno real. Lo que se pierda lo repone el backfill.
 *
 * Y dos órdenes que importan: el manifiesto se escribe ANTES de congelar —al revés, el propio
 * manifiesto sería un nodo inmutable que no se puede crear— y lo que vio el Motor va a su
 * subcarpeta, porque mezclarlo con lo que subió el cliente hace creer que hay documentos
 * duplicados.
 */
const ACTOR: ActorExpediente = { tipo: 'sistema', id: null, roles: [], permisos: [] } as unknown as ActorExpediente;

describe('ExpedienteHooksService', () => {
  let expedientes: { abrir: jest.Mock; porSujeto: jest.Mock; congelar: jest.Mock };
  let nodos: { registrarArchivo: jest.Mock };
  let materializador: { asegurarNodoDeContactos: jest.Mock; escribirManifiesto: jest.Mock };
  let actores: { sistema: jest.Mock };
  let storage: { headObject: jest.Mock; getBucket: jest.Mock };
  let service: ExpedienteHooksService;
  let original: boolean;
  let orden: string[];

  beforeEach(() => {
    original = env.EXPEDIENTES_ENABLED;
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = true;
    orden = [];
    expedientes = {
      abrir: jest.fn(async () => ({ id: 'exp-1' })),
      porSujeto: jest.fn(async () => ({ id: 'exp-1', estado: 'abierto' })),
      congelar: jest.fn(async () => {
        orden.push('congelar');
        return 0;
      }),
    };
    nodos = { registrarArchivo: jest.fn(async () => ({ id: 'n1' })) };
    materializador = {
      asegurarNodoDeContactos: jest.fn(async () => undefined),
      escribirManifiesto: jest.fn(async () => {
        orden.push('manifiesto');
      }),
    };
    actores = { sistema: jest.fn(() => ACTOR) };
    storage = { headObject: jest.fn(async () => ({ contentType: 'application/pdf', sizeBytes: 2048 })), getBucket: jest.fn(() => 'atlas') };

    service = new ExpedienteHooksService(
      expedientes as unknown as ExpedienteService,
      nodos as unknown as NodoService,
      materializador as unknown as MaterializadorService,
      actores as unknown as ActorService,
      storage as unknown as DocumentStorageService,
    );
  });

  afterEach(() => {
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = original;
  });

  describe('tolerancia a fallo', () => {
    it('un fallo al abrir el expediente NO tumba el alta', async () => {
      expedientes.abrir.mockRejectedValueOnce(new Error('base caída') as never);

      await expect(
        service.alIniciarOnboarding({ tenantId: 't1', customerId: 'c1', sessionId: 's1', customerCode: null }),
      ).resolves.toBeUndefined();
    });

    it('un fallo al registrar evidencia tampoco: el archivo ya está guardado por su propio camino', async () => {
      nodos.registrarArchivo.mockRejectedValueOnce(new Error('nodo duplicado') as never);

      await expect(
        service.alRegistrarEvidencia({
          tenantId: 't1',
          customerId: 'c1',
          documentType: 'selfie',
          evidenceDocumentId: 'e1',
          storageKey: 'k/selfie.jpg',
          storageBucket: 'atlas',
          sha256: null,
          mimeType: 'image/jpeg',
          sizeBytes: '100',
        }),
      ).resolves.toBeUndefined();
    });

    it('con el módulo apagado ningún gancho toca nada', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;

      await service.alIniciarOnboarding({ tenantId: 't1', customerId: 'c1', sessionId: null, customerCode: null });
      await service.alEnviarOnboarding({ tenantId: 't1', customerId: 'c1' });

      expect(expedientes.abrir).not.toHaveBeenCalled();
      expect(expedientes.porSujeto).not.toHaveBeenCalled();
    });
  });

  describe('inicio del alta', () => {
    it('abre el expediente del cliente y le pone el nodo de contactos', async () => {
      await service.alIniciarOnboarding({ tenantId: 't1', customerId: 'c1', sessionId: 's1', customerCode: 'CLI-1' });

      expect(expedientes.abrir).toHaveBeenCalledWith({
        tenantId: 't1',
        subjectType: 'customer',
        subjectId: 'c1',
        sessionId: 's1',
        customerCode: 'CLI-1',
        actor: ACTOR,
      });
      expect(materializador.asegurarNodoDeContactos).toHaveBeenCalledWith({ tenantId: 't1', expedienteId: 'exp-1', actor: ACTOR });
    });
  });

  describe('evidencia del cliente', () => {
    const base = {
      tenantId: 't1',
      customerId: 'c1',
      evidenceDocumentId: 'e1',
      storageKey: 'k/doc',
      storageBucket: 'atlas',
      sha256: 'h1',
      mimeType: 'image/jpeg',
      sizeBytes: '100',
    };

    it('cada tipo cae en su carpeta con su nombre y su clase', async () => {
      await service.alRegistrarEvidencia({ ...base, documentType: 'identity_front' });
      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(
        expect.objectContaining({ carpeta: 'auth', nombre: 'anverso.jpg', clase: 'identity_front', origen: 'onboarding' }),
      );

      await service.alRegistrarEvidencia({ ...base, documentType: 'proof_of_address', mimeType: 'application/pdf' });
      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(expect.objectContaining({ carpeta: 'domicilio', nombre: 'comprobante.pdf' }));
    });

    it('un tipo desconocido cae en `otros` en vez de perderse', async () => {
      await service.alRegistrarEvidencia({ ...base, documentType: 'contrato_raro' });

      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(expect.objectContaining({ carpeta: 'otros', nombre: 'documento.jpg' }));
    });

    it('la extensión sale del tipo real: png se distingue de jpg', async () => {
      await service.alRegistrarEvidencia({ ...base, documentType: 'selfie', mimeType: 'image/png' });

      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(expect.objectContaining({ nombre: 'selfie.png' }));
    });

    it('sin tamaño se pregunta al almacén con un HEAD, no descargando el objeto', async () => {
      await service.alRegistrarEvidencia({ ...base, documentType: 'bank_statement', sizeBytes: null, storageBucket: null, mimeType: null });

      expect(storage.headObject).toHaveBeenCalledWith('k/doc');
      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(
        expect.objectContaining({ sizeBytes: '2048', mimeType: 'application/pdf', storageBucket: 'atlas' }),
      );
    });

    it('con tamaño y bucket ya conocidos no se molesta al almacén', async () => {
      await service.alRegistrarEvidencia({ ...base, documentType: 'selfie' });

      expect(storage.headObject).not.toHaveBeenCalled();
    });

    it('si el almacén no contesta se registra igual: una fila sin tamaño es mejor que ninguna fila', async () => {
      storage.headObject.mockRejectedValueOnce(new Error('MinIO caído') as never);

      await service.alRegistrarEvidencia({ ...base, documentType: 'selfie', sizeBytes: null, storageBucket: null });

      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(expect.objectContaining({ sizeBytes: null, storageBucket: null }));
    });

    it('un cliente sin expediente no crea nodos huérfanos: lo repone el backfill', async () => {
      expedientes.porSujeto.mockResolvedValueOnce(null as never);

      await service.alRegistrarEvidencia({ ...base, documentType: 'selfie' });

      expect(nodos.registrarArchivo).not.toHaveBeenCalled();
    });
  });

  describe('objetos del Motor', () => {
    it('van a su propia subcarpeta: mezclarlos haría creer que hay documentos duplicados', async () => {
      await service.alCerrarEjecucionDelMotor({
        tenantId: 't1',
        customerId: 'c1',
        engineRequestId: 'req-1',
        carpeta: 'auth',
        claves: [{ clave: 'k/a.jpg', nombre: 'recorte.jpg', mimeType: 'image/jpeg' }],
      });

      expect(nodos.registrarArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ carpeta: 'auth/motor', origen: 'motor', clase: 'verificacion', engineRequestId: 'req-1' }),
      );
    });

    it('lo del extracto se clasifica como análisis y se registran todas las claves', async () => {
      await service.alCerrarEjecucionDelMotor({
        tenantId: 't1',
        customerId: 'c1',
        engineRequestId: 'req-2',
        carpeta: 'extractos',
        claves: [
          { clave: 'k/1.pdf', nombre: 'pagina-1.pdf', mimeType: 'application/pdf' },
          { clave: 'k/2.pdf', nombre: 'pagina-2.pdf', mimeType: 'application/pdf' },
        ],
      });

      expect(nodos.registrarArchivo).toHaveBeenCalledTimes(2);
      expect(nodos.registrarArchivo).toHaveBeenLastCalledWith(expect.objectContaining({ carpeta: 'extractos/motor', clase: 'analisis' }));
    });

    it('sin expediente no se registra nada', async () => {
      expedientes.porSujeto.mockResolvedValueOnce(null as never);

      await service.alCerrarEjecucionDelMotor({
        tenantId: 't1',
        customerId: 'c1',
        engineRequestId: 'req-1',
        carpeta: 'auth',
        claves: [{ clave: 'k/a.jpg', nombre: 'a.jpg', mimeType: 'image/jpeg' }],
      });

      expect(nodos.registrarArchivo).not.toHaveBeenCalled();
    });
  });

  describe('envío del alta', () => {
    it('escribe el manifiesto ANTES de congelar: al revés no se podría crear', async () => {
      await service.alEnviarOnboarding({ tenantId: 't1', customerId: 'c1' });

      expect(orden).toEqual(['manifiesto', 'congelar']);
    });

    it('un expediente que ya no está abierto no se vuelve a congelar', async () => {
      expedientes.porSujeto.mockResolvedValueOnce({ id: 'exp-1', estado: 'enviado' } as never);

      await service.alEnviarOnboarding({ tenantId: 't1', customerId: 'c1' });

      expect(materializador.escribirManifiesto).not.toHaveBeenCalled();
      expect(expedientes.congelar).not.toHaveBeenCalled();
    });

    it('un fallo al escribir el manifiesto no congela a medias ni tumba el envío', async () => {
      materializador.escribirManifiesto.mockRejectedValueOnce(new Error('sin espacio') as never);

      await expect(service.alEnviarOnboarding({ tenantId: 't1', customerId: 'c1' })).resolves.toBeUndefined();
      expect(expedientes.congelar).not.toHaveBeenCalled();
    });
  });
});
