/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Hace que cada alta nazca con su carpeta ordenada, sin que el alta dependa de ello.
 * @system engancha el expediente al onboarding; ningún fallo suyo puede tumbar un alta.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ActorService } from './actor.service.js';
import { ExpedienteService } from './expediente.service.js';
import { MaterializadorService } from './materializador.service.js';
import { NodoService } from './nodo.service.js';
import { CARPETA_POR_TIPO, type ClaseNodo, type OrigenNodo, type SujetoExpediente } from '../expedientes.types.js';

/**
 * Los ganchos del alta, en un solo sitio y todos tolerantes a fallo.
 *
 * ## Por qué nada de esto puede lanzar hacia arriba
 *
 * El expediente es una VISTA de archivos que ya se guardaron por su propio camino: la evidencia
 * sigue yendo a `evidence_documents` y al almacén tanto si el catálogo se escribe como si no. Que
 * un alta —el momento en que una persona está esperando con el teléfono en la mano— falle porque
 * no se pudo crear una carpeta sería cambiar un problema cosmético por uno real. Lo que se pierde
 * si algo falla aquí lo repara el job de backfill, que existe justo para eso.
 *
 * Por eso cada método atrapa, registra y sigue. Es la única parte del módulo donde tragarse un
 * error es lo correcto, y por eso está concentrada aquí en vez de repartida por los servicios.
 */
@Injectable()
export class ExpedienteHooksService {
  private readonly logger = new Logger(ExpedienteHooksService.name);

  constructor(
    private readonly expedientes: ExpedienteService,
    private readonly nodos: NodoService,
    private readonly materializador: MaterializadorService,
    private readonly actores: ActorService,
    private readonly storage: DocumentStorageService,
  ) {}

  private activo(): boolean {
    return env.EXPEDIENTES_ENABLED;
  }

  private async intentar(nombre: string, accion: () => Promise<unknown>): Promise<void> {
    if (!this.activo()) return;
    try {
      await accion();
    } catch (error) {
      // Se registra con el nombre del gancho para que el backfill sepa qué reparar, y con el
      // mensaje del error sin traza: aquí no hay nada que depurar en caliente.
      this.logger.warn(`Gancho de expediente «${nombre}» falló: ${(error as Error).message}`);
    }
  }

  /** 1. El alta abre el expediente con sus cuatro carpetas y el nodo de contactos. */
  async alIniciarOnboarding(input: {
    tenantId: string;
    customerId: string;
    sessionId: string | null;
    customerCode: string | null;
  }): Promise<void> {
    await this.intentar('inicio-onboarding', async () => {
      const actor = this.actores.sistema();
      const expediente = await this.expedientes.abrir({
        tenantId: input.tenantId,
        subjectType: 'customer',
        subjectId: input.customerId,
        sessionId: input.sessionId,
        customerCode: input.customerCode,
        actor,
      });
      await this.materializador.asegurarNodoDeContactos({
        tenantId: input.tenantId,
        expedienteId: expediente.id,
        actor,
      });
    });
  }

  /**
   * 2 y 3. Un documento de evidencia entra en su carpeta.
   *
   * Cubre identidad, extracto y comprobante de domicilio: los tres llegan por el mismo camino
   * (`evidence_documents`) y sólo se distinguen por `documentType`, así que un solo gancho con el
   * mapa de carpetas evita tres versiones que podrían divergir.
   */
  async alRegistrarEvidencia(input: {
    tenantId: string;
    customerId: string;
    documentType: string;
    /** `null` cuando el gancho corre fuera de la transacción que creó la fila y no tiene su id. */
    evidenceDocumentId: string | null;
    storageKey: string;
    storageBucket: string | null;
    sha256: string | null;
    mimeType: string | null;
    sizeBytes: string | null;
  }): Promise<void> {
    await this.intentar('registro-evidencia', () =>
      this.registrarArchivoDe({
        ...input,
        subjectType: 'customer',
        subjectId: input.customerId,
        origen: 'onboarding',
        nombreBase: null,
      }),
    );
  }

  /**
   * 7. Nace un comercio: se abre su expediente.
   *
   * Sin sesión —el alta de un comercio no tiene sesiones de onboarding— y sin nodo de contactos,
   * que se compone desde la agenda de un CLIENTE y aquí no habría de dónde. `customerCode` lleva
   * lo que un operador reconoce del negocio (ver `PartnerProfileService.start`): es la columna
   * por la que la pantalla busca y la que enseña en la lista.
   */
  async alCrearComercio(input: { tenantId: string; partnerId: string; customerCode: string | null }): Promise<void> {
    await this.intentar('alta-comercio', async () => {
      await this.expedientes.abrir({
        tenantId: input.tenantId,
        subjectType: 'partner',
        subjectId: input.partnerId,
        sessionId: null,
        customerCode: input.customerCode,
        actor: this.actores.sistema(),
      });
    });
  }

  /**
   * 8. Un comercio sube un archivo: su QR de cobro, el poder de su representante o un documento
   * que el ERP guardó sobre su cuenta.
   *
   * Es el mismo camino que la evidencia del cliente, con otro sujeto: el objeto ya está en el
   * almacén por su propio flujo (`partner_qr_codes`, el representante, el ERP) y aquí sólo se
   * anota en la carpeta que le toca. `objeto` es lo que ese flujo ya midió del almacén (tipo real,
   * tamaño, hash del contenido): se recibe tal cual para no volver a preguntar. `nombreBase`
   * permite al llamador nombrar el archivo con lo que sabe y el mapa no —«qr bancario (sucursal
   * 3)», «kyb»— sin abrir una entrada por cada caso.
   */
  async alRegistrarArchivoDelComercio(input: {
    tenantId: string;
    partnerId: string;
    documentType: string;
    nombreBase?: string | null;
    origen?: OrigenNodo;
    storageKey: string;
    objeto: { contentType: string | null; sizeBytes: number | null; sha256Hex: string | null } | null;
  }): Promise<void> {
    await this.intentar('archivo-comercio', () =>
      this.registrarArchivoDe({
        tenantId: input.tenantId,
        subjectType: 'partner',
        subjectId: input.partnerId,
        documentType: input.documentType,
        nombreBase: input.nombreBase ?? null,
        origen: input.origen ?? 'onboarding',
        evidenceDocumentId: null,
        storageKey: input.storageKey,
        // El permiso de subida lo emitió este mismo almacén: el objeto está en su bucket. Con eso y
        // las medidas del origen, `medir` no tiene que ir al almacén.
        storageBucket: input.objeto ? this.storage.getBucket() : null,
        sha256: input.objeto?.sha256Hex ?? null,
        mimeType: input.objeto?.contentType ?? null,
        sizeBytes: input.objeto?.sizeBytes == null ? null : String(input.objeto.sizeBytes),
      }),
    );
  }

  /** El registro común: busca el expediente del sujeto, resuelve carpeta y nombre, mide y anota. */
  private async registrarArchivoDe(input: {
    tenantId: string;
    subjectType: SujetoExpediente;
    subjectId: string;
    documentType: string;
    nombreBase: string | null;
    origen: OrigenNodo;
    evidenceDocumentId: string | null;
    storageKey: string;
    storageBucket: string | null;
    sha256: string | null;
    mimeType: string | null;
    sizeBytes: string | null;
  }): Promise<void> {
    const actor = this.actores.sistema();
    const expediente = await this.expedientes.porSujeto(input.tenantId, input.subjectType, input.subjectId);
    if (!expediente) {
      this.logger.warn(`El sujeto ${input.subjectType}:${input.subjectId} no tiene expediente; lo repondrá el backfill.`);
      return;
    }

    const destino = CARPETA_POR_TIPO[input.documentType] ?? CARPETA_POR_TIPO.other;
    const medidas = await this.medir(input);
    const extension = (medidas.mimeType ?? '').includes('pdf') ? 'pdf' : (medidas.mimeType ?? '').includes('png') ? 'png' : 'jpg';

    await this.nodos.registrarArchivo({
      tenantId: input.tenantId,
      expedienteId: expediente.id,
      carpeta: destino.carpeta,
      nombre: `${input.nombreBase ?? destino.nombre}.${extension}`,
      origen: input.origen,
      clase: destino.clase as ClaseNodo,
      storageKey: input.storageKey,
      storageBucket: medidas.storageBucket,
      sha256: input.sha256,
      mimeType: medidas.mimeType,
      sizeBytes: medidas.sizeBytes,
      evidenceDocumentId: input.evidenceDocumentId,
      actor,
    });
  }

  /**
   * Lo que el llamador no sabe del objeto, preguntado al almacén.
   *
   * El camino de identidad conoce tamaño y tipo porque los guarda `evidence_documents`; el del
   * extracto no —sólo tiene la clave—, y sin esto la fila del expediente quedaba sin tamaño. En la
   * pantalla eso se lee como «no se sabe», que en la carpeta de la persona es justo la casilla que
   * no debería estar vacía en su documento más sensible.
   *
   * Es un HEAD, no una descarga: cuesta un viaje y no mueve los bytes. Si el almacén no contesta se
   * registra igual con lo que había: una fila sin tamaño sigue siendo mejor que ninguna fila.
   */
  private async medir(input: {
    storageKey: string;
    storageBucket: string | null;
    mimeType: string | null;
    sizeBytes: string | null;
  }): Promise<{ storageBucket: string | null; mimeType: string | null; sizeBytes: string | null }> {
    if (input.sizeBytes && input.storageBucket) return input;
    try {
      const cabecera = await this.storage.headObject(input.storageKey);
      return {
        storageBucket: input.storageBucket ?? this.storage.getBucket(),
        mimeType: input.mimeType ?? cabecera?.contentType ?? null,
        sizeBytes: input.sizeBytes ?? (cabecera ? String(cabecera.sizeBytes) : null),
      };
    } catch (error) {
      this.logger.warn(`No se pudo medir ${input.storageKey}: ${(error as Error).message}`);
      return input;
    }
  }

  /** 4. Los objetos que el Motor conserva de una verificación de identidad o de un extracto. */
  async alCerrarEjecucionDelMotor(input: {
    tenantId: string;
    customerId: string;
    engineRequestId: string;
    carpeta: 'auth' | 'extractos';
    claves: ReadonlyArray<{ clave: string; nombre: string; mimeType: string }>;
  }): Promise<void> {
    await this.intentar('ejecucion-motor', async () => {
      const actor = this.actores.sistema();
      const expediente = await this.expedientes.porSujeto(input.tenantId, 'customer', input.customerId);
      if (!expediente) return;

      for (const objeto of input.claves) {
        await this.nodos.registrarArchivo({
          tenantId: input.tenantId,
          expedienteId: expediente.id,
          // Subcarpeta propia: lo que vio el Motor no es lo mismo que lo que subió el cliente, y
          // mezclarlos haría creer que hay documentos duplicados.
          carpeta: `${input.carpeta}/motor`,
          nombre: objeto.nombre,
          origen: 'motor',
          clase: input.carpeta === 'auth' ? 'verificacion' : 'analisis',
          storageKey: objeto.clave,
          storageBucket: null,
          sha256: null,
          mimeType: objeto.mimeType,
          sizeBytes: null,
          engineRequestId: input.engineRequestId,
          actor,
        });
      }
    });
  }

  /** 6. El cliente envía: se escribe el manifiesto y se congela lo que había. */
  async alEnviarOnboarding(input: { tenantId: string; customerId: string }): Promise<void> {
    await this.intentar('envio-onboarding', async () => {
      const actor = this.actores.sistema();
      const expediente = await this.expedientes.porSujeto(input.tenantId, 'customer', input.customerId);
      if (!expediente || expediente.estado !== 'abierto') return;

      // El manifiesto se escribe ANTES de congelar: si se congelara primero, el propio manifiesto
      // sería un nodo inmutable que no se puede crear.
      await this.materializador.escribirManifiesto({
        tenantId: input.tenantId,
        expedienteId: expediente.id,
        actor,
      });
      await this.expedientes.congelar({ tenantId: input.tenantId, expedienteId: expediente.id, actor });
    });
  }
}
