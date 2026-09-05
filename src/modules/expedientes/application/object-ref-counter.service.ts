/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Impide que borrar un archivo de una carpeta deje ciego a otro proceso que lo usaba.
 * @system cuenta quién referencia una clave del almacén antes de borrar el objeto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { env } from '../../../config/env.js';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';

/** Quién sigue apuntando a la clave. Vacío = el objeto se puede borrar. */
export type Referencias = {
  nodos: number;
  evidencia: number;
  extractos: number;
  motor: number;
  /** El Motor no contestó. NO es lo mismo que «no referencia»: ver la nota de `contar`. */
  motorIncierto: boolean;
};

/**
 * El conteo de referencias que hace seguro borrar.
 *
 * El expediente REFERENCIA objetos que también apuntan `evidence_documents`, `bank_statement_reviews`
 * y cuatro columnas del Motor. Borrar el objeto porque alguien quitó un nodo del explorador dejaría
 * al worker de extractos leyendo una clave que ya no está, y al revisor con un carnet que
 * desapareció sin que nadie lo borrara.
 *
 * **Ante la duda, no se borra.** Si el Motor no responde, la purga se salta ese objeto y lo
 * reintenta en la vuelta siguiente. Un huérfano en el bucket cuesta unos kilobytes; un hueco en la
 * evidencia de una decisión de crédito no se repara.
 */
@Injectable()
export class ObjectRefCounterService {
  private readonly logger = new Logger(ObjectRefCounterService.name);

  constructor(
    private readonly repository: ExpedientesRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async contar(storageKey: string, excluyendoNodoId?: string): Promise<Referencias> {
    const nodos = await this.repository.contarNodosPorClave(storageKey, excluyendoNodoId);

    const evidencia = await this.contarEn(
      `${atlasSchemaFor('evidence_documents')}.evidence_documents`,
      's3_key',
      storageKey,
    );
    const extractos = await this.contarEn(
      `${atlasSchemaFor('bank_statement_reviews')}.bank_statement_reviews`,
      'storage_key',
      storageKey,
    );

    const motor = await this.contarEnElMotor(storageKey);
    return { nodos, evidencia, extractos, motor: motor ?? 0, motorIncierto: motor === null };
  }

  /** `true` sólo si NADIE apunta y el Motor sí contestó. */
  puedeBorrarse(referencias: Referencias): boolean {
    if (referencias.motorIncierto) return false;
    return referencias.nodos === 0 && referencias.evidencia === 0 && referencias.extractos === 0 && referencias.motor === 0;
  }

  private async contarEn(tabla: string, columna: string, storageKey: string): Promise<number> {
    const filas = await this.sequelize.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${tabla} WHERE ${columna} = :storageKey`,
      { replacements: { storageKey }, type: QueryTypes.SELECT },
    );
    return Number(filas[0]?.total ?? '0');
  }

  /**
   * Las cuatro columnas del Motor, por HTTP.
   *
   * Viven en OTRA base (el Motor tiene la suya en Neon), así que no hay `JOIN` posible: la única
   * forma honesta de preguntarlo es preguntárselo. `null` significa «no lo sé», y quien llama lo
   * trata como «no borres».
   */
  private async contarEnElMotor(storageKey: string): Promise<number | null> {
    const base = env.DECISION_ENGINE_BASE_URL;
    const apiKey = env.DECISION_ENGINE_API_KEY;
    if (!base || !apiKey) return null;

    try {
      const url = `${base.replace(/\/$/, '')}/v1/workers/storage/references?key=${encodeURIComponent(storageKey)}`;
      const respuesta = await fetch(url, {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!respuesta.ok) return null;
      const cuerpo = (await respuesta.json()) as { references?: number };
      return typeof cuerpo.references === 'number' ? cuerpo.references : null;
    } catch (error) {
      this.logger.warn(`No se pudo preguntar al motor por ${storageKey}: ${(error as Error).message}`);
      return null;
    }
  }
}
