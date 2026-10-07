/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business El cliente puede ver los extractos bancarios que subió y volver a descargarlos: son SUS documentos.
 * @system lista las revisiones de extracto del cliente y lee el PDF del almacén, sólo si es suyo.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { BankStatementReviewModel } from '../../../database/models/index.js';
import { bankStatementFileName } from '../domain/bank-statement-file-name.js';

/** Cuántos extractos se enseñan. Un cliente sube uno cada pocos meses: dos años caben de sobra. */
export const BANK_STATEMENT_ARCHIVE_LIMIT = 24;

/**
 * El archivo de extractos del cliente.
 *
 * ## Por qué existe
 *
 * La app sólo sabía preguntar por el ÚLTIMO extracto (`bank-statements/latest`), y sólo por su estado.
 * Quien había subido tres no podía ver los dos anteriores, y nadie podía recuperar el archivo que él
 * mismo entregó: para tener una copia de su propio documento había que pedírsela a soporte.
 *
 * ## Qué se devuelve y qué no
 *
 * El PDF tal y como se subió, y sólo a su dueño. No viaja ninguna URL del almacén: el archivo sale
 * por la API, con la sesión del cliente, igual que el informe de gastos. Una URL firmada es un enlace
 * que se puede reenviar; una respuesta autenticada no.
 *
 * ## Por qué se comprueba dos veces de quién es
 *
 * La revisión se busca por cliente Y por id, y además la clave del almacén tiene que empezar por
 * `{tenant}/{cliente}/`. La segunda comprobación es la que cubre una fila con la clave de otro
 * cliente —el fallo que `assertOwnedPdf` cierra en la subida desde el 2026-09-14—: si una así hubiera
 * quedado escrita antes de aquel arreglo, aquí no se sirve.
 */
@Injectable()
export class BankStatementArchiveService {
  constructor(
    @InjectModel(BankStatementReviewModel) private readonly reviews: typeof BankStatementReviewModel,
    private readonly storage: DocumentStorageService,
  ) {}

  /** Los extractos del cliente, del más reciente al más antiguo. */
  list(tenantId: string, customerId: string): Promise<BankStatementReviewModel[]> {
    return this.reviews.findAll({
      where: { tenantId, customerId, deleted: false },
      order: [['_created_at', 'DESC']],
      limit: BANK_STATEMENT_ARCHIVE_LIMIT,
    } as FindOptions);
  }

  /**
   * El PDF de un extracto del cliente.
   *
   * `BANK_STATEMENT_NOT_FOUND` si la revisión no es suya o no existe —la misma respuesta para las dos,
   * para no confirmar que existe la de otro—. `BANK_STATEMENT_FILE_NOT_AVAILABLE` si la revisión es
   * suya pero el archivo ya no está en el almacén (retención cumplida o almacén sin configurar): es
   * un estado real y la app lo distingue de un fallo.
   */
  async file(tenantId: string, customerId: string, reviewId: string): Promise<{ pdf: Buffer; fileName: string }> {
    const review = await this.reviews.findOne({ where: { id: reviewId, tenantId, customerId, deleted: false } } as FindOptions);
    if (!review) throw new NotFoundException('BANK_STATEMENT_NOT_FOUND');

    const storageKey = review.storageKey;
    if (!storageKey || !storageKey.startsWith(`${tenantId}/${customerId}/`)) {
      throw new NotFoundException('BANK_STATEMENT_FILE_NOT_AVAILABLE');
    }
    const pdf = await this.storage.readObject(storageKey);
    if (!pdf) throw new NotFoundException('BANK_STATEMENT_FILE_NOT_AVAILABLE');

    return { pdf, fileName: bankStatementFileName(review) };
  }
}
