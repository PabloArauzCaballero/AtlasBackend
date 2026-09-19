/**
 * @file Servicio de aplicación: orquesta la locución de bienvenida del canal móvil.
 * @business Esta pieza pone la voz de la marca en el momento en que alguien entra a la app.
 * @system pide la locución al worker del motor y la re-sirve bajo la sesión de quien entra.
 */
import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../config/env.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { EngineAudioClient } from './engine-audio.client.js';
import type { WelcomeAudioState, WelcomeAudioView } from './mobile-welcome-audio.schemas.js';

/** Cómo se traduce el estado del worker al que el móvil entiende. */
const ESTADO_POR_EJECUCION: Readonly<Record<string, WelcomeAudioState>> = {
  QUEUED: 'PENDING',
  RUNNING: 'PENDING',
  SUCCEEDED: 'READY',
  SUCCEEDED_WITH_WARNINGS: 'READY',
  FAILED: 'UNAVAILABLE',
  CANCELLED: 'UNAVAILABLE',
};

/**
 * Cuánto se recuerda a quién pertenece cada locución.
 *
 * Cinco minutos porque el saludo se consume en segundos: se pide al entrar y se reproduce mientras
 * termina de dibujarse la primera pantalla. Un plazo largo no compra nada y alarga la ventana en la
 * que un identificador filtrado sigue sirviendo.
 */
const VIGENCIA_MS = 5 * 60_000;

/**
 * Caracteres admitidos en el nombre que se pone en boca de la marca.
 *
 * Se filtra AQUÍ y no se confía en el motor. El nombre sale de la base de datos, sí, pero llegó ahí
 * escrito por una persona en un formulario, y lo que se hace con él es meterlo en una plantilla que
 * termina siendo el texto que se sintetiza. Un nombre con signos raros produce, en el mejor caso,
 * una locución que suena mal y que se cachea así para siempre; en el peor, texto que el proveedor
 * interpreta. Letras, espacios, guion y apóstrofo cubren cualquier nombre real.
 */
const NOMBRE_ADMITIDO = /[^\p{L}\p{M}\s'-]/gu;

@Injectable()
export class MobileWelcomeAudioService {
  private readonly logger = new Logger(MobileWelcomeAudioService.name);

  /**
   * Quién pidió cada locución.
   *
   * ## Por qué existe
   *
   * El identificador de una ejecución es un UUID que el móvil recibe y luego usa para descargar los
   * bytes. Sin esta anotación, cualquier cliente autenticado que consiguiera un identificador ajeno
   * se descargaría el saludo de otra persona — que dice su nombre de pila. Es poca cosa y es
   * exactamente el tipo de poca cosa que no debe estar abierta.
   *
   * ## Por qué en memoria y no en una tabla
   *
   * Porque no es un dato del negocio: es una autorización que vive segundos. Una tabla obligaría a
   * una migración, un modelo y una limpieza periódica para guardar algo que caduca antes de que
   * termine de escribirse. El precio es que un reinicio del proceso pierde las anotaciones vivas y
   * esas descargas contestan 404; el desenlace es que alguien no oye un saludo, y eso es aceptable.
   */
  private readonly duenos = new Map<string, { customerId: string; expira: number }>();

  constructor(
    private readonly engine: EngineAudioClient,
    private readonly customers: CustomersRepository,
  ) {}

  /**
   * Encarga el saludo de quien acaba de entrar.
   *
   * El nombre NO viene del móvil: se lee del perfil vigente del cliente autenticado. Aceptarlo del
   * cliente convertiría este endpoint en un sintetizador de texto a voz de uso libre pagado por el
   * inquilino, que es lo que el catálogo de plantillas del motor existe para impedir.
   */
  async start(tenantId: string, customerId: string): Promise<WelcomeAudioView> {
    if (!this.engine.isConfigured) {
      // 503 y no 500: no es que algo se haya roto, es que esta instalación no tiene el worker de
      // locución conectado. El móvil lo trata como «hoy no hay saludo» y entra igual.
      throw new ServiceUnavailableException({
        code: 'WELCOME_AUDIO_NOT_CONFIGURED',
        message: 'La locución de bienvenida no está disponible en esta instalación.',
      });
    }

    const nombre = await this.primerNombre(tenantId, customerId);
    const plantilla = nombre ? env.DECISION_ENGINE_WELCOME_TEMPLATE : env.DECISION_ENGINE_WELCOME_FALLBACK_TEMPLATE;
    const variables: Record<string, string> = nombre ? { name: nombre } : {};

    try {
      const { requestId, status } = await this.engine.enqueue(tenantId, plantilla, variables);
      this.anotarDueno(requestId, customerId);
      return { requestId, status: ESTADO_POR_EJECUCION[status] ?? 'PENDING' };
    } catch (error) {
      /*
       * Un motor que no contesta NO se propaga como 500.
       *
       * Se vio contra el motor local: encolar una locución devolvió `500 Connection terminated`
       * —un tropiezo del pool de la base de datos del OTRO servicio— y este endpoint lo reenvió
       * tal cual. Eso significa que una app recién abierta recibía un error del servidor por un
       * saludo, que es un detalle; y que la monitorización se llenaba de 500 por algo que a nadie
       * le impide usar el producto. `UNAVAILABLE` dice exactamente lo que pasó desde el punto de
       * vista de quien entra: hoy no hay saludo.
       *
       * El `requestId` vacío es deliberado: no hay ninguna ejecución que consultar, y devolver uno
       * inventado invitaría al móvil a preguntar por él.
       */
      this.logger.warn(`No se pudo encargar la bienvenida del cliente ${customerId}: ${describir(error)}`);
      return { requestId: '', status: 'UNAVAILABLE' };
    }
  }

  /** El estado de la locución. Es lo que el móvil consulta en bucle mientras arranca. */
  async get(tenantId: string, requestId: string, customerId: string): Promise<WelcomeAudioView> {
    this.exigirDueno(requestId, customerId);
    try {
      const { status } = await this.engine.status(tenantId, requestId);
      return { requestId, status: ESTADO_POR_EJECUCION[status] ?? 'PENDING' };
    } catch (error) {
      /*
       * Un fallo al consultar NO es un fallo de la locución, pero para el móvil da igual: las dos
       * cosas significan «no vas a oír nada». Se contesta `UNAVAILABLE` en vez de propagar un 500
       * porque un saludo no puede convertirse en una pantalla de error encima de la app recién
       * abierta. Queda en el log, que es donde hay que mirarlo.
       */
      this.logger.warn(`No se pudo consultar la locución ${requestId}: ${describir(error)}`);
      return { requestId, status: 'UNAVAILABLE' };
    }
  }

  /** Los bytes, para que el móvil los guarde en su caché y los reproduzca. */
  async audio(tenantId: string, requestId: string, customerId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    this.exigirDueno(requestId, customerId);
    try {
      return await this.engine.audio(tenantId, requestId);
    } catch (error) {
      this.logger.warn(`No se pudo servir el audio de ${requestId}: ${describir(error)}`);
      throw new NotFoundException({
        code: 'WELCOME_AUDIO_NOT_READY',
        message: 'La locución todavía no está disponible.',
      });
    }
  }

  /**
   * El primer nombre del cliente, limpio y en condiciones de decirse en voz alta.
   *
   * Se queda con el PRIMER token: los nombres compuestos existen, pero un saludo que dice los dos
   * nombres suena a que lo está leyendo una máquina de un formulario — que es justo lo que se
   * intenta que no parezca.
   */
  private async primerNombre(tenantId: string, customerId: string): Promise<string | null> {
    try {
      const perfil = await this.customers.findCurrentProfile(tenantId, customerId);
      const crudo = (perfil?.firstName ?? '').replace(NOMBRE_ADMITIDO, ' ').trim();
      const primero = crudo.split(/\s+/u)[0] ?? '';
      // Dos letras como mínimo: una inicial suelta se locuta como un balbuceo.
      return primero.length >= 2 ? primero.slice(0, 40) : null;
    } catch (error) {
      // Sin nombre se saluda igual, con la plantilla genérica. No leer el perfil no puede impedir
      // entrar a la app.
      this.logger.warn(`No se pudo leer el nombre del cliente ${customerId}: ${describir(error)}`);
      return null;
    }
  }

  private anotarDueno(requestId: string, customerId: string): void {
    const ahora = Date.now();
    // Barrido perezoso: se limpia al escribir, que es la única vez que este mapa crece. Un
    // temporizador periódico mantendría vivo el proceso para vaciar un mapa casi siempre vacío.
    for (const [clave, valor] of this.duenos) {
      if (valor.expira <= ahora) this.duenos.delete(clave);
    }
    this.duenos.set(requestId, { customerId, expira: ahora + VIGENCIA_MS });
  }

  private exigirDueno(requestId: string, customerId: string): void {
    const anotado = this.duenos.get(requestId);
    if (!anotado || anotado.expira <= Date.now()) {
      // 404 y no 403: un 403 confirmaría que ese identificador existe, que es justo lo que no debe
      // poder averiguarse probando.
      throw new NotFoundException({
        code: 'WELCOME_AUDIO_NOT_FOUND',
        message: 'No hay ninguna locución de bienvenida con ese identificador.',
      });
    }
    if (anotado.customerId !== customerId) {
      throw new ForbiddenException({
        code: 'WELCOME_AUDIO_FORBIDDEN',
        message: 'Esa locución no es tuya.',
      });
    }
  }
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
