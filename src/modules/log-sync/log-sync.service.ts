/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
 * @system sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { truncate } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Collection, MongoClient } from 'mongodb';
import { env } from '../../config/env.js';
import { redactSensitiveText } from '../../common/utils/privacy/redact-text.util.js';
import { countLines, formatError, getFileSize, mongoSyncHint, readLogDelta, trimLogFileToTail } from './log-sync.reader.util.js';

// Retención de la colección de logs en Mongo. Sin TTL la colección crece sin límite y, como el
// archivo local se trunca tras sincronizar, Mongo pasa a ser la única copia. 30 días es un punto
// intermedio entre trazabilidad forense y coste/PII residual. Constante local (no env) a propósito:
// cambiarla es una decisión de gobernanza, no de configuración por entorno.
const LOG_RETENTION_SECONDS = 30 * 24 * 60 * 60;

import type { LogSource, RemoteLogDocument } from './log-sync.documents.js';
@Injectable()
export class ArchivoLogMongoSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ArchivoLogMongoSyncService.name);
  private readonly bootId = randomUUID();
  private readonly logFilePath = resolve(env.LOG_SYNC_FILE_PATH);
  private readonly source: LogSource = {
    filePath: this.logFilePath,
    fileName: basename(this.logFilePath),
  };

  private client: MongoClient | null = null;
  private collection: Collection<RemoteLogDocument> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private startupInserted = false;
  private bootResetDone = false;
  private currentOffset: number | null = null;
  private sequence = 0;
  private consecutiveFailures = 0;
  private pausedUntil = 0;

  onApplicationBootstrap(): void {
    // El tope local corre SIEMPRE, con destino remoto o sin él. Antes, sin
    // `MONGO_DB_URL_CONNECTION` esto salía por la puerta de atrás sin dejar nada en marcha, y
    // entonces NADIE acotaba el archivo: el logger seguía apilando líneas y el único código que
    // truncaba —`maybeResetLogFileAfterFullSync`— exigía una confirmación de Mongo que no iba a
    // llegar. Desactivar la sincronización no debería significar dejar el disco a su suerte.
    if (!env.MONGO_DB_URL_CONNECTION) {
      this.logger.warn(
        `MONGO_DB_URL_CONNECTION no configurado; sincronizacion remota de ${this.source.fileName} desactivada. ` +
          `El archivo local se seguira acotando a ${env.LOG_SYNC_LOCAL_MAX_BYTES} bytes.`,
      );
      void this.enforceLocalSizeCap();
      this.timer = setInterval(() => {
        void this.enforceLocalSizeCap();
      }, env.LOG_SYNC_INTERVAL_MS);
      return;
    }

    this.logger.log(`Sincronizacion de ${this.source.fileName} habilitada con idArranque=${this.bootId}.`);
    void this.flushWithLock();
    this.timer = setInterval(() => {
      void this.flushWithLock();
    }, env.LOG_SYNC_INTERVAL_MS);
  }

  /**
   * Válvula de seguridad: recorta el archivo local si se pasó del tope, pase lo que pase con
   * MongoDB. No sustituye a `maybeResetLogFileAfterFullSync` —esa sigue siendo la vía normal y
   * sólo borra lo que Mongo ya confirmó—; cubre el caso en que la vía normal no puede actuar.
   *
   * Tras recortar, el offset vuelve a 0: las posiciones anteriores ya no significan nada sobre el
   * archivo nuevo, y seguir usándolas haría que el siguiente flush leyera desde un punto
   * arbitrario en mitad de una línea.
   */
  private async enforceLocalSizeCap(): Promise<void> {
    try {
      const max = env.LOG_SYNC_LOCAL_MAX_BYTES;
      const size = await getFileSize(this.logFilePath);
      if (size <= max) return;

      const result = await trimLogFileToTail(this.logFilePath, Math.floor(max / 2));
      if (!result.trimmed) return;

      this.currentOffset = 0;
      this.logger.warn(
        `${this.source.fileName} supero el tope local de ${max} bytes y se recorto a su cola: ` +
          `${result.droppedBytes} bytes descartados, ${result.newSize} conservados. ` +
          'Las lineas descartadas NO llegaron a MongoDB.',
      );
    } catch (error) {
      this.logger.warn(`No se pudo aplicar el tope local a ${this.source.fileName}: ${formatError(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.flushInFlight;
    await this.client?.close();
  }

  private async flushWithLock(): Promise<void> {
    if (this.flushInFlight) return;

    this.flushInFlight = this.flush().finally(() => {
      this.flushInFlight = null;
    });

    await this.flushInFlight;
  }

  private async flush(): Promise<void> {
    if (Date.now() < this.pausedUntil) return;

    try {
      const collection = await this.getCollection();
      await this.ensureStartupDocument(collection);

      const offset = this.currentOffset ?? 0;
      const delta = await readLogDelta(this.logFilePath, offset, env.LOG_SYNC_MAX_CHUNK_BYTES);

      if (!delta.exists) {
        this.markSyncSuccess();
        return;
      }

      if (delta.rotated) {
        await collection.insertOne({
          type: 'rotation',
          bootId: this.bootId,
          idArranque: this.bootId,
          capturedAt: new Date(),
          service: 'atlas-backend',
          source: this.source,
          previousOffset: delta.previousOffset,
          fileSize: delta.fileSize,
        });
      }

      if (delta.content.length === 0) {
        this.currentOffset = delta.offsetTo;
        await this.maybeResetLogFileAfterFullSync(delta.offsetTo, delta.fileSize, collection);
        this.markSyncSuccess();
        return;
      }

      await collection.insertOne({
        type: 'append',
        bootId: this.bootId,
        idArranque: this.bootId,
        sequence: ++this.sequence,
        capturedAt: new Date(),
        service: 'atlas-backend',
        source: this.source,
        offsetFrom: delta.offsetFrom,
        offsetTo: delta.offsetTo,
        bytes: Buffer.byteLength(delta.content, 'utf8'),
        chars: delta.content.length,
        lineCount: countLines(delta.content),
        // Redacción defensiva: aunque Archivo.log ya se escribe scrubbeado por AppFileLogger, este
        // camino también sincroniza logs preexistentes (LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT) que
        // pudieron escribirse antes del scrubber. Segunda capa antes de persistir en Mongo.
        content: redactSensitiveText(delta.content),
      });

      this.currentOffset = delta.offsetTo;
      await this.maybeResetLogFileAfterFullSync(delta.offsetTo, delta.fileSize, collection);
      this.markSyncSuccess();
    } catch (error) {
      await this.resetMongoClient();
      this.registerFailure(error);
      // Con el destino remoto caido nadie mas va a truncar: la valvula tiene que actuar aqui.
      await this.enforceLocalSizeCap();
    }
  }

  /**
   * Reinicia (trunca) `Archivo.log` una vez confirmado que su contenido ya quedó
   * reflejado por completo en MongoDB, para que no crezca sin límite entre reinicios
   * del backend — MongoDB ya tiene la historia completa, el archivo local es desechable.
   *
   * Solo trunca si `syncedUpToOffset` (lo que este flush acaba de confirmar en Mongo)
   * cubre todo el archivo tal como estaba al momento de leerlo (`fileSizeAtSync`) — si
   * el log excede `LOG_SYNC_MAX_CHUNK_BYTES` puede tomar varios ciclos de flush llegar
   * a ese punto, y mientras tanto no se toca el archivo. Justo antes de truncar vuelve a
   * medir el tamaño del archivo: si alguien escribió algo nuevo en el ínterin (el logger
   * de la app sigue apilando líneas en paralelo), no trunca esta vez y lo reintenta en el
   * siguiente ciclo — así nunca se pierde una línea que no haya sido sincronizada.
   */
  private async maybeResetLogFileAfterFullSync(
    syncedUpToOffset: number,
    fileSizeAtSync: number,
    collection: Collection<RemoteLogDocument>,
  ): Promise<void> {
    if (this.bootResetDone) return;
    if (fileSizeAtSync === 0 || syncedUpToOffset < fileSizeAtSync) return;

    const currentSize = await getFileSize(this.logFilePath);
    if (currentSize !== fileSizeAtSync) return;

    await truncate(this.logFilePath, 0);
    this.currentOffset = 0;
    this.bootResetDone = true;

    await collection.insertOne({
      type: 'rotation',
      bootId: this.bootId,
      idArranque: this.bootId,
      capturedAt: new Date(),
      service: 'atlas-backend',
      source: this.source,
      previousOffset: fileSizeAtSync,
      fileSize: 0,
    });
    this.logger.log(`${this.source.fileName} reiniciado: ${fileSizeAtSync} bytes ya confirmados en MongoDB.`);
  }

  private async getCollection(): Promise<Collection<RemoteLogDocument>> {
    if (this.collection) return this.collection;

    if (!env.MONGO_DB_URL_CONNECTION) {
      throw new Error('MONGO_DB_URL_CONNECTION no configurado.');
    }

    const client = new MongoClient(env.MONGO_DB_URL_CONNECTION, {
      serverSelectionTimeoutMS: env.LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS,
    });
    await client.connect();
    this.client = client;

    const collection = client.db(env.MONGO_LOGS_DB_NAME).collection<RemoteLogDocument>(env.MONGO_LOGS_COLLECTION);
    await collection.createIndexes([
      { key: { bootId: 1, capturedAt: 1 }, name: 'idx_boot_captured_at' },
      { key: { 'source.filePath': 1, capturedAt: -1 }, name: 'idx_source_captured_at' },
      // TTL: Mongo purga documentos cuyo capturedAt supere la retención. Evita crecimiento ilimitado
      // y acota la ventana de PII residual. Si el valor cambia, Mongo actualiza el TTL en caliente.
      { key: { capturedAt: 1 }, name: 'idx_ttl_captured_at', expireAfterSeconds: LOG_RETENTION_SECONDS },
    ]);

    this.collection = collection;
    return collection;
  }

  private async resetMongoClient(): Promise<void> {
    this.collection = null;
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => undefined);
  }

  private markSyncSuccess(): void {
    this.consecutiveFailures = 0;
    this.pausedUntil = 0;
  }

  private registerFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    const message = formatError(error);
    const hint = mongoSyncHint(message);

    if (this.consecutiveFailures < env.LOG_SYNC_FAILURES_BEFORE_PAUSE) {
      this.logger.warn(
        `No se pudo sincronizar ${this.source.fileName} con MongoDB (${this.consecutiveFailures}/${env.LOG_SYNC_FAILURES_BEFORE_PAUSE}): ${hint}`,
      );
      return;
    }

    this.pausedUntil = Date.now() + env.LOG_SYNC_FAILURE_PAUSE_MS;
    this.logger.warn(
      `Sincronizacion de ${this.source.fileName} pausada por ${env.LOG_SYNC_FAILURE_PAUSE_MS}ms tras ${this.consecutiveFailures} fallos consecutivos: ${hint}`,
    );
  }

  private async ensureStartupDocument(collection: Collection<RemoteLogDocument>): Promise<void> {
    if (this.startupInserted) return;

    const fileSizeAtStartup = await getFileSize(this.logFilePath);
    this.currentOffset = await this.resolveInitialOffset(collection, fileSizeAtStartup);

    await collection.insertOne({
      type: 'startup',
      bootId: this.bootId,
      idArranque: this.bootId,
      capturedAt: new Date(),
      service: 'atlas-backend',
      source: this.source,
      fileSizeAtStartup,
      startOffset: this.currentOffset,
      intervalMs: env.LOG_SYNC_INTERVAL_MS,
      maxChunkBytes: env.LOG_SYNC_MAX_CHUNK_BYTES,
      process: {
        pid: process.pid,
        cwd: process.cwd(),
        nodeEnv: env.NODE_ENV,
      },
    });

    this.startupInserted = true;
  }

  private async resolveInitialOffset(collection: Collection<RemoteLogDocument>, fileSizeAtStartup: number): Promise<number> {
    const latestAppend = await collection.findOne(
      {
        type: 'append',
        'source.filePath': this.source.filePath,
      },
      { sort: { capturedAt: -1 } },
    );

    if (latestAppend?.type === 'append' && latestAppend.offsetTo <= fileSizeAtStartup) {
      return latestAppend.offsetTo;
    }

    if (latestAppend?.type === 'append' && latestAppend.offsetTo > fileSizeAtStartup) {
      return 0;
    }

    return env.LOG_SYNC_IMPORT_EXISTING_ON_FIRST_BOOT ? 0 : fileSizeAtStartup;
  }
}
