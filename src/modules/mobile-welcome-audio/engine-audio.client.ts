/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza pone la voz de la marca en el momento en que alguien entra a la app.
 * @system encarga locuciones al worker de audio del motor y recoge sus bytes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';

/**
 * El worker de locución del motor, visto desde aquí.
 *
 * ## Por qué no reutiliza `DecisionEngineClient`
 *
 * Porque habla con otro plano del motor y con otra semántica. `DecisionEngineClient` está construido
 * alrededor de una decisión: empuja un cuerpo, reintenta con circuito, y sabe que un 422 es «la
 * política dice que no» y hay que devolverlo como respuesta válida. Aquí nada de eso aplica —un 422
 * es una plantilla mal pedida, y reintentar una locución que falló es pedir una segunda síntesis
 * facturada del mismo texto—. Meterlo dentro habría obligado a llenar aquel cliente de excepciones
 * a sus propias reglas.
 *
 * ## Por qué NO reintenta
 *
 * Cada generación cuesta dinero. El motor ya trae idempotencia por contenido —misma frase, misma
 * voz, misma ejecución— pero apoyarse en ella para reintentar a ciegas es apoyarse en el bolsillo
 * del inquilino. Un saludo que no llega no rompe nada: la app entra igual, en silencio.
 */
@Injectable()
export class EngineAudioClient {
  private readonly logger = new Logger(EngineAudioClient.name);

  /** Sin URL ni credencial no hay locución, y quien llame debe poder distinguirlo de un motor caído. */
  get isConfigured(): boolean {
    return Boolean(env.DECISION_ENGINE_BASE_URL && this.apiKey());
  }

  /**
   * Encarga la locución. Devuelve el identificador con el que se consultará.
   *
   * El motor responde `202` incluso cuando no va a sintetizar nada: si esa frase ya se dijo con
   * esta misma voz, la ejecución terminará sirviendo lo que había. Por eso el estado se consulta
   * después en vez de asumir que hay que esperar.
   */
  async enqueue(
    tenantId: string,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<{ requestId: string; status: string }> {
    const cuerpo = await this.json<{ requestId?: string; status?: string }>(
      'POST',
      tenantId,
      '/v1/workers/audio-tts/runs',
      { templateCode, variables },
    );
    if (!cuerpo?.requestId) throw new Error('El motor aceptó la locución sin devolver requestId.');
    return { requestId: cuerpo.requestId, status: String(cuerpo.status ?? 'QUEUED') };
  }

  /** Estado de una locución encargada. Es lo que el móvil consulta en bucle, a través del servicio. */
  async status(tenantId: string, requestId: string): Promise<{ status: string; errorMessage: string | null }> {
    const cuerpo = await this.json<{ status?: string; errorMessage?: string | null }>(
      'GET',
      tenantId,
      `/v1/workers/audio-tts/runs/${encodeURIComponent(requestId)}`,
    );
    return { status: String(cuerpo?.status ?? 'QUEUED'), errorMessage: cuerpo?.errorMessage ?? null };
  }

  /**
   * Los bytes del audio.
   *
   * No devuelve una URL firmada porque el motor no las emite: el permiso se decide en cada petición,
   * y esa decisión la toma esta credencial. Lo que llega aquí se re-sirve al móvil bajo SU sesión,
   * de modo que ninguna de las dos credenciales sale nunca del servidor.
   */
  async audio(tenantId: string, requestId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const respuesta = await this.fetchOnce('GET', tenantId, `/v1/workers/audio-tts/runs/${encodeURIComponent(requestId)}/audio`);
    if (!respuesta.ok) throw new Error(`El motor respondió ${respuesta.status} al servir el audio.`);
    const mimeType = respuesta.headers.get('content-type') ?? 'audio/mpeg';
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    /*
     * Un cuerpo diminuto NO es un audio: es un error servido con 200, que es como responden varias
     * pasarelas cuando la cuota se agota. Sin esta comprobación el móvil se descargaría doscientos
     * bytes de JSON con extensión .mp3 y el fallo aparecería en el teléfono, como un saludo que no
     * suena y no dice por qué.
     */
    if (bytes.length < 512) throw new Error(`El audio pesa ${bytes.length} bytes: no es reproducible.`);
    return { bytes, mimeType };
  }

  /**
   * Credencial del plano de gestión, con preferencia por la propia del audio.
   *
   * Ver `env.decision-engine.schema.ts`: la llave de locución existe aparte para poder revocarla
   * sola. Nunca se cae a `DECISION_ENGINE_API_KEY`, que es la de ejecución de decisiones.
   */
  private apiKey(): string {
    return env.DECISION_ENGINE_AUDIO_API_KEY ?? env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? '';
  }

  private async json<T>(method: 'GET' | 'POST', tenantId: string, path: string, body?: unknown): Promise<T | null> {
    const respuesta = await this.fetchOnce(method, tenantId, path, body);
    const texto = await respuesta.text().catch(() => '');
    if (!respuesta.ok) {
      throw new Error(`El motor respondió ${respuesta.status} en ${path}. ${texto.slice(0, 300)}`);
    }
    if (!texto) return null;
    try {
      const parseado = JSON.parse(texto) as Record<string, unknown>;
      /*
       * El motor envuelve sus respuestas en `{ data }` en unas rutas y no en otras. Se aceptan las
       * dos formas en vez de asumir una: asumir la equivocada devuelve el SOBRE como si fuera el
       * contenido, y entonces `requestId` es `undefined` sin que nada haya fallado.
       */
      const contenido = parseado && typeof parseado === 'object' && 'data' in parseado ? parseado.data : parseado;
      return (contenido ?? null) as T | null;
    } catch {
      this.logger.warn(`El motor devolvió un cuerpo no-JSON en ${path}.`);
      return null;
    }
  }

  private async fetchOnce(method: 'GET' | 'POST', tenantId: string, path: string, body?: unknown): Promise<Response> {
    const base = (env.DECISION_ENGINE_BASE_URL ?? '').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.DECISION_ENGINE_AUDIO_TIMEOUT_MS);
    try {
      return await fetch(`${base}${path}`, {
        method,
        headers: {
          'x-api-key': this.apiKey(),
          // El motor numera sus inquilinos igual que este backend; es la misma suposición que ya
          // hace el resto de la integración (ver `DecisionEngineClient.listArtifacts`).
          'x-tenant-id': tenantId,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
