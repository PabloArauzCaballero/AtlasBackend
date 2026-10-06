/**
 * @file Reconciliador: manda al Motor todo paquete de identidad que se quedó sin verificación.
 * @business Una persona que subió su carnet no puede quedar fuera de la cola de revisión del Motor porque una llamada de la app falló.
 * @system cada pocos minutos busca intentos `onboarding_package` en revisión sin intento del canal móvil y los verifica con las imágenes ya guardadas.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type FindOptions } from 'sequelize';
import { EvidenceDocumentModel, IdentityVerificationAttemptModel } from '../../database/models/index.js';
import { DocumentStorageService } from '../../common/storage/document-storage.service.js';
import { LIVENESS_IDENTITY_CHANNEL } from '../../common/utils/identity/identity-result.util.js';
import { MobileIdentityService } from './mobile-identity.service.js';
import { startIdentityVerificationSchema } from './mobile-identity.schemas.js';

const CANAL_PAQUETE = 'onboarding_package';
/** Margen para que la app haga su propia llamada al Motor antes de que se la haga el servidor. */
const ESPERA_MS = 10 * 60_000;
/** Más viejo que esto ya no se rescata solo: lo ve una persona desde el portal. */
const VIGENCIA_MS = 14 * 24 * 3_600_000;
const CADA_MS = 5 * 60_000;
const POR_PASADA = 20;
/** Tope de páginas por pasada: acota la consulta aunque casi todos los paquetes sean de clientes que el Motor ya vio. */
const MAX_PAGINAS = 10;
/** Un intento del canal móvil que sigue PENDING más de esto se dio por perdido (el Motor no contestó). */
const PENDIENTE_VIVO_MS = 15 * 60_000;
/** Tope de intentos por cliente: un fallo permanente no se reintenta para siempre ni inunda el Motor. */
const MAX_INTENTOS = 5;

/**
 * Por qué existe.
 *
 * La app guarda el paquete de identidad y DESPUÉS pregunta al Motor; esa segunda llamada traga
 * cualquier error a propósito para no cortar el alta. Resultado medido en TEST (cliente 53,
 * 2026-09-30): el intento quedó `pending_review` en el portal y el Motor nunca supo de él, sin que
 * nada lo señalara. La garantía no puede depender de un cliente que falla en silencio: la da el
 * servidor, que tiene las imágenes y vuelve a intentarlo hasta que el Motor las vea.
 *
 * Es idempotente por intento: `start` crea la fila del canal móvil, y con ella el cliente deja de
 * ser candidato mientras esa fila viva (resuelta, o PENDING reciente); si el Motor no contestó
 * (`UNAVAILABLE`) se reintenta, hasta 5 veces por cliente. Cada rescate y cada fallo quedan en el log con `evento: identity_reconcile_*`.
 */
@Injectable()
export class IdentityEngineReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IdentityEngineReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;

  constructor(
    @InjectModel(IdentityVerificationAttemptModel) private readonly attempts: typeof IdentityVerificationAttemptModel,
    @InjectModel(EvidenceDocumentModel) private readonly evidencias: typeof EvidenceDocumentModel,
    private readonly storage: DocumentStorageService,
    private readonly identidad: MobileIdentityService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.IDENTITY_RECONCILE_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.pasada(), CADA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Una pasada. Devuelve cuántos paquetes mandó al Motor. Nunca lanza. */
  async pasada(ahora: Date = new Date()): Promise<number> {
    if (this.corriendo) return 0;
    this.corriendo = true;
    let enviados = 0;
    const atascados: IdentityVerificationAttemptModel[] = [];
    try {
      const vistos = new Set<string>();
      let trabajados = 0;
      let cursor: string | null = null;
      // Se pagina por `id`: los paquetes de clientes que el Motor ya vio ('omitido') siguen en `pending_review`
      // y, con un solo `limit`, ocupaban para siempre los huecos de la pasada y dejaban fuera a los atascados más viejos.
      paginas: for (let pagina = 0; pagina < MAX_PAGINAS && trabajados < POR_PASADA; pagina += 1) {
        const pendientes: IdentityVerificationAttemptModel[] = await this.attempts.findAll({
          where: {
            verificationChannel: CANAL_PAQUETE,
            finalResult: 'pending_review',
            requestedAt: { [Op.between]: [new Date(ahora.getTime() - VIGENCIA_MS), new Date(ahora.getTime() - ESPERA_MS)] },
            ...(cursor ? { id: { [Op.lt]: cursor } } : {}),
          },
          order: [['id', 'DESC']],
          limit: POR_PASADA,
        } as FindOptions);
        for (const intento of pendientes) {
          const clave = `${intento.tenantId}:${intento.customerId}`;
          if (!intento.customerId || vistos.has(clave)) continue;
          vistos.add(clave);
          const resultado = await this.reconciliar(intento);
          if (resultado === 'sin-motor') break paginas;
          if (resultado !== 'omitido') trabajados += 1;
          if (resultado === 'enviado') enviados += 1;
          else if (resultado === 'fallido') atascados.push(intento);
          if (trabajados >= POR_PASADA) break paginas;
        }
        if (pendientes.length < POR_PASADA) break;
        cursor = String(pendientes[pendientes.length - 1]?.id);
      }
    } catch (error: unknown) {
      this.log('identity_reconcile_failed', { reason: describir(error) });
    } finally {
      this.corriendo = false;
    }
    // La alarma: paquetes que ESTA pasada no pudo mandar. Si el Motor está caído o falta una imagen,
    // quien lea el log lo ve en cada pasada en vez de descubrirlo cuando alguien pregunte por un caso.
    if (atascados.length > 0) this.alarmar(atascados);
    return enviados;
  }

  private async reconciliar(intento: IdentityVerificationAttemptModel): Promise<'enviado' | 'omitido' | 'fallido' | 'sin-motor'> {
    const base = { tenantId: intento.tenantId, customerId: intento.customerId, packageAttemptId: intento.id };
    try {
      /*
       * «Ya lo vio el Motor» es un intento del canal móvil que NO se perdió: resuelto (VERIFIED,
       * REJECTED, IN_REVIEW) o todavía PENDING y reciente. Uno `UNAVAILABLE` (el Motor estaba caído)
       * o PENDING desde hace rato NO cuenta: es exactamente el paquete que hay que volver a mandar.
       */
      const vigentes = await this.attempts.count({
        where: {
          tenantId: intento.tenantId,
          customerId: intento.customerId,
          verificationChannel: LIVENESS_IDENTITY_CHANNEL,
          [Op.or]: [
            { finalResult: { [Op.in]: ['VERIFIED', 'REJECTED', 'IN_REVIEW'] } },
            { finalResult: 'PENDING', requestedAt: { [Op.gt]: new Date(Date.now() - PENDIENTE_VIVO_MS) } },
          ],
        },
      } as FindOptions);
      if (vigentes > 0) return 'omitido';
      const hechos = await this.attempts.count({
        where: { tenantId: intento.tenantId, customerId: intento.customerId, verificationChannel: LIVENESS_IDENTITY_CHANNEL },
      } as FindOptions);
      if (hechos >= MAX_INTENTOS) {
        this.log('identity_reconcile_gave_up', { ...base, intentos: hechos });
        return 'omitido';
      }

      const documentos = await this.evidencias.findAll({
        where: { tenantId: intento.tenantId, customerId: intento.customerId, deleted: { [Op.ne]: true } },
        order: [['id', 'ASC']],
      } as FindOptions);
      const ultimo = (tipo: string) => [...documentos].reverse().find((doc) => doc.documentType === tipo && doc.s3Key);
      const frente = ultimo('identity_front');
      const selfie = ultimo('selfie');
      if (!frente?.s3Key || !selfie?.s3Key) {
        this.log('identity_reconcile_skipped', { ...base, reason: 'FALTAN_IMAGENES' });
        return 'fallido';
      }
      const reverso = ultimo('identity_back');
      const [bf, bs, br] = await Promise.all([
        this.storage.readObject(frente.s3Key),
        this.storage.readObject(selfie.s3Key),
        reverso?.s3Key ? this.storage.readObject(reverso.s3Key) : Promise.resolve(null),
      ]);
      if (!bf || !bs) {
        this.log('identity_reconcile_skipped', { ...base, reason: 'OBJETO_AUSENTE' });
        return 'fallido';
      }
      const cuerpo = startIdentityVerificationSchema.parse({
        documentFront: bf.toString('base64'),
        selfie: bs.toString('base64'),
        ...(br ? { documentBack: br.toString('base64') } : {}),
        customerId: intento.customerId,
      });
      const vista = await this.identidad.start(intento.tenantId, cuerpo, `reconcile-identity-${intento.id}`);
      this.log('identity_reconcile_sent', { ...base, verificationId: vista.verificationId });
      return 'enviado';
    } catch (error: unknown) {
      // El Motor sin configurar no es un fallo de este paquete: se corta la pasada sin ruido.
      if (error instanceof ServiceUnavailableException) return 'sin-motor';
      this.log('identity_reconcile_failed', { ...base, reason: describir(error) });
      return 'fallido';
    }
  }

  private alarmar(atascados: IdentityVerificationAttemptModel[]): void {
    const fechas = atascados.map((a) => a.requestedAt?.getTime() ?? Number.POSITIVE_INFINITY);
    const masAntiguo = Math.min(...fechas);
    this.log('identity_reconcile_backlog', {
      atascados: atascados.length,
      masAntiguo: Number.isFinite(masAntiguo) ? new Date(masAntiguo).toISOString() : null,
    });
  }

  private log(evento: string, datos: Record<string, unknown>): void {
    const linea = JSON.stringify({ evento, ...datos });
    if (evento === 'identity_reconcile_sent') this.logger.log(linea);
    else this.logger.warn(linea);
  }
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
