import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Collection, Document, Filter, MongoClient } from 'mongodb';
import { env } from '../../config/env.js';
import { MongoLogsQueryDto } from './mongo-logs.schemas.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read-only counterpart to `ArchivoLogMongoSyncService`. That service only
 * writes chunks of Archivo.log into Mongo (`atlas_logs.archivo_log_updates`
 * by default); nothing previously read them back out over HTTP. This exposes
 * that collection for the admin portal's log viewer, using its own MongoClient
 * so read traffic never blocks the write/sync path.
 */
@Injectable()
export class MongoLogsQueryService implements OnModuleDestroy {
  private client: MongoClient | null = null;

  async listLogs(query: MongoLogsQueryDto) {
    const collection = await this.getCollection();
    const filter: Filter<Document> = {};
    if (query.type) filter.type = query.type;
    if (query.service) filter.service = query.service;
    // Treat search input as plain text; user-controlled regex can cause ReDoS.
    if (query.q) filter.content = { $regex: escapeRegex(query.q), $options: 'i' };
    if (query.from || query.to) {
      filter.capturedAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const limit = query.limit;
    const skip = (query.page - 1) * limit;
    const [items, total] = await Promise.all([
      collection.find(filter).sort({ capturedAt: -1 }).skip(skip).limit(limit).toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      items: items.map((item) => ({
        id: String(item._id),
        type: item.type,
        service: item.service,
        capturedAt: item.capturedAt,
        content: item.content ?? null,
        lineCount: item.lineCount ?? null,
        bytes: item.bytes ?? null,
        fileSize: item.fileSize ?? null,
        source: item.source ?? null,
      })),
      meta: {
        page: query.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  private async getCollection(): Promise<Collection<Document>> {
    if (!env.MONGO_DB_URL_CONNECTION) {
      throw new ServiceUnavailableException('MONGO_LOGS_NOT_CONFIGURED');
    }
    if (!this.client) {
      this.client = new MongoClient(env.MONGO_DB_URL_CONNECTION, {
        serverSelectionTimeoutMS: env.LOG_SYNC_MONGO_SERVER_SELECTION_TIMEOUT_MS,
      });
      await this.client.connect();
    }
    return this.client.db(env.MONGO_LOGS_DB_NAME).collection(env.MONGO_LOGS_COLLECTION);
  }
}
