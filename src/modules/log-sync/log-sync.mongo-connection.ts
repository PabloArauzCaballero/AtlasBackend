/**
 * @file Conexión a MongoDB de la sincronización de logs: cliente, colección con índices/TTL y offset inicial.
 * @business Esta pieza preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
 * @system sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.
 */
import { Collection, MongoClient } from 'mongodb';
import { env } from '../../config/env.js';
import type { RemoteLogDocument } from './log-sync.documents.js';

// Retención de la colección de logs en Mongo. Sin TTL la colección crece sin límite y, como el
// archivo local se trunca tras sincronizar, Mongo pasa a ser la única copia. 30 días es un punto
// intermedio entre trazabilidad forense y coste/PII residual. Constante local (no env) a propósito:
// cambiarla es una decisión de gobernanza, no de configuración por entorno.
const LOG_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** Cliente y colección perezosos; `reset` los descarta para reconectar tras un fallo. */
export class LogSyncMongoConnection {
  private clientRef: MongoClient | null = null;
  private collectionRef: Collection<RemoteLogDocument> | null = null;

  async getCollection(): Promise<Collection<RemoteLogDocument>> {
    if (this.collectionRef) return this.collectionRef;

    if (!env.MONGO_DB_URL_CONNECTION) {
      throw new Error('MONGO_DB_URL_CONNECTION no configurado.');
    }

    const client = new MongoClient(env.MONGO_DB_URL_CONNECTION, {
      serverSelectionTimeoutMS: env.LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS,
    });
    await client.connect();
    this.clientRef = client;

    const collection = client.db(env.MONGO_LOGS_DB_NAME).collection<RemoteLogDocument>(env.MONGO_LOGS_COLLECTION);
    await collection.createIndexes([
      { key: { bootId: 1, capturedAt: 1 }, name: 'idx_boot_captured_at' },
      { key: { 'source.filePath': 1, capturedAt: -1 }, name: 'idx_source_captured_at' },
      // TTL: Mongo purga documentos cuyo capturedAt supere la retención. Evita crecimiento ilimitado
      // y acota la ventana de PII residual. Si el valor cambia, Mongo actualiza el TTL en caliente.
      { key: { capturedAt: 1 }, name: 'idx_ttl_captured_at', expireAfterSeconds: LOG_RETENTION_SECONDS },
    ]);

    this.collectionRef = collection;
    return collection;
  }

  async reset(): Promise<void> {
    this.collectionRef = null;
    const client = this.clientRef;
    this.clientRef = null;
    await client?.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.clientRef?.close();
  }
}

export async function resolveInitialLogOffset(
  collection: Collection<RemoteLogDocument>,
  filePath: string,
  fileSizeAtStartup: number,
): Promise<number> {
  const latestAppend = await collection.findOne(
    {
      type: 'append',
      'source.filePath': filePath,
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
