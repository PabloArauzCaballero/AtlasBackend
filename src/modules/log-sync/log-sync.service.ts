import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat, truncate } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Collection, MongoClient } from 'mongodb';
import { env } from '../../config/env.js';

type RemoteLogDocument =
  | {
      type: 'startup';
      bootId: string;
      idArranque: string;
      capturedAt: Date;
      service: string;
      source: LogSource;
      fileSizeAtStartup: number;
      startOffset: number;
      intervalMs: number;
      maxChunkBytes: number;
      process: {
        pid: number;
        cwd: string;
        nodeEnv: string;
      };
    }
  | {
      type: 'append';
      bootId: string;
      idArranque: string;
      sequence: number;
      capturedAt: Date;
      service: string;
      source: LogSource;
      offsetFrom: number;
      offsetTo: number;
      bytes: number;
      chars: number;
      lineCount: number;
      content: string;
    }
  | {
      type: 'rotation';
      bootId: string;
      idArranque: string;
      capturedAt: Date;
      service: string;
      source: LogSource;
      previousOffset: number;
      fileSize: number;
    };

type LogSource = {
  filePath: string;
  fileName: string;
};

export type LogDelta = {
  exists: boolean;
  rotated: boolean;
  previousOffset: number;
  offsetFrom: number;
  offsetTo: number;
  content: string;
  fileSize: number;
};

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
    if (!env.MONGO_DB_URL_CONNECTION) {
      this.logger.warn('MONGO_DB_URL_CONNECTION no configurado; sincronizacion remota de Archivo.log desactivada.');
      return;
    }

    this.logger.log(`Sincronizacion de ${this.source.fileName} habilitada con idArranque=${this.bootId}.`);
    void this.flushWithLock();
    this.timer = setInterval(() => {
      void this.flushWithLock();
    }, env.LOG_SYNC_INTERVAL_MS);
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
        content: delta.content,
      });

      this.currentOffset = delta.offsetTo;
      await this.maybeResetLogFileAfterFullSync(delta.offsetTo, delta.fileSize, collection);
      this.markSyncSuccess();
    } catch (error) {
      await this.resetMongoClient();
      this.registerFailure(error);
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

export async function readLogDelta(filePath: string, lastOffset: number, maxChunkBytes: number): Promise<LogDelta> {
  const safeLastOffset = Math.max(0, lastOffset);
  const fileSize = await getFileSize(filePath);

  if (fileSize < 0) {
    return {
      exists: false,
      rotated: false,
      previousOffset: safeLastOffset,
      offsetFrom: safeLastOffset,
      offsetTo: safeLastOffset,
      content: '',
      fileSize: 0,
    };
  }

  const rotated = fileSize < safeLastOffset;
  const offsetFrom = rotated ? 0 : safeLastOffset;
  const offsetTo = Math.min(fileSize, offsetFrom + maxChunkBytes);

  if (offsetTo <= offsetFrom) {
    return {
      exists: true,
      rotated,
      previousOffset: safeLastOffset,
      offsetFrom,
      offsetTo,
      content: '',
      fileSize,
    };
  }

  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath, { start: offsetFrom, end: offsetTo - 1 });

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    exists: true,
    rotated,
    previousOffset: safeLastOffset,
    offsetFrom,
    offsetTo,
    content: Buffer.concat(chunks).toString('utf8'),
    fileSize,
  };
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return -1;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mongoSyncHint(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('tls') || normalized.includes('ssl') || normalized.includes('alert internal error')) {
    return (
      'fallo TLS al conectar con MongoDB. Revisa MONGO_DB_URL_CONNECTION, host SRV, usuario/password, TLS del cluster ' +
      'y allowlist de IP en MongoDB Atlas. Detalle: ' +
      message
    );
  }
  if (normalized.includes('authentication failed') || normalized.includes('auth')) {
    return `credenciales MongoDB rechazadas. Revisa usuario, password y authSource. Detalle: ${message}`;
  }
  if (normalized.includes('server selection') || normalized.includes('enotfound') || normalized.includes('econnrefused')) {
    return `MongoDB no esta alcanzable desde este backend. Revisa red, DNS, cluster host y allowlist. Detalle: ${message}`;
  }
  return message;
}
