/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system registra qué se preguntó en el cuaderno, nunca qué se obtuvo.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { DataNotebookQueryHistoryModel } from '../../database/models/index.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DATA_NOTEBOOK_LIMITS } from './data-notebook.constants.js';
import { NotebookHistoryEntryDto } from './data-notebook.schemas.js';

export type NotebookHistoryRow = {
  id: string;
  language: string;
  source: string;
  datasetCode: string | null;
  datasetPage: number | null;
  rowCount: number | null;
  durationMs: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

/**
 * El historial guarda la PREGUNTA y descarta la RESPUESTA.
 *
 * Ni este servicio ni la tabla tienen por dónde recibir filas de resultado: el DTO no las declara
 * y la tabla no tiene columna. Es a propósito y es la mitad del diseño — un historial que
 * guardara también lo devuelto sería una segunda copia de datos personales fuera de `read_api`,
 * sin enmascarado y sin caducidad, creada justamente por la función que se añadió para dar
 * trazabilidad.
 *
 * Lo que sí se guarda es el código, que es el artefacto reproducible: con la celda y el dataset se
 * puede volver a ejecutar y obtener el resultado contra los datos de HOY, que además es lo
 * correcto para auditar. Y `row_count` distingue una exploración de una extracción sin conservar
 * ni una fila.
 */
@Injectable()
export class DataNotebookHistoryService {
  constructor(
    @InjectModel(DataNotebookQueryHistoryModel)
    private readonly model: typeof DataNotebookQueryHistoryModel,
  ) {}

  async record(entry: NotebookHistoryEntryDto, user: AuthenticatedUser): Promise<{ id: string }> {
    const fila = await this.model.create({
      tenantId: user.tenantId ?? null,
      actorUserId: user.sub,
      actorRole: user.role,
      language: entry.language,
      source: entry.source.slice(0, DATA_NOTEBOOK_LIMITS.maxHistorySourceLength),
      datasetCode: entry.datasetCode ?? null,
      datasetPage: entry.datasetPage ?? null,
      rowCount: entry.rowCount ?? null,
      durationMs: entry.durationMs ?? null,
      status: entry.status,
      // Se recorta porque un traceback largo no aporta más que sus primeras líneas, y porque la
      // columna tiene tope: un mensaje más largo tumbaría la inserción y con ella la trazabilidad.
      errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, 500) : null,
      createdAt: new Date(),
    });

    return { id: String(fila.id) };
  }

  /**
   * Devuelve lo último de QUIEN PREGUNTA, no de toda la organización.
   *
   * El historial de otra persona es una vista de su trabajo, y leerlo es una capacidad distinta de
   * tener acceso al cuaderno. Si algún día hace falta —una investigación, una auditoría— se añade
   * con su propio permiso y su propio registro, no ensanchando éste.
   */
  /**
   * Una página del historial, con el TOTAL de lo que hay detrás.
   *
   * El total no es un adorno de la interfaz: sin él, una lista que devuelve veinte filas no puede
   * distinguir «esto es todo lo que hay» de «hay ciento ochenta más», y la pantalla tendría que
   * elegir entre ofrecer un «siguiente» que a veces no lleva a ninguna parte o esconderlo cuando sí
   * había más. Se cuenta con el MISMO `where` que se lista, en una sola ida a la base
   * (`findAndCountAll`), porque contar con otro criterio produciría una paginación que se pasa de
   * largo o se queda corta.
   */
  async listOwn(user: AuthenticatedUser, limit: number, offset = 0): Promise<{ rows: NotebookHistoryRow[]; total: number }> {
    const where = { tenantId: user.tenantId ?? null, actorUserId: user.sub };
    const { rows: filas, count } = await this.model.findAndCountAll({
      where,
      // El desempate por `id` es lo que hace estable la paginación. Ordenando sólo por fecha, dos
      // ejecuciones registradas en el mismo milisegundo —dos celdas corridas de seguido— pueden
      // salir en distinto orden en cada consulta, y entonces una fila aparece en dos páginas o no
      // aparece en ninguna.
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    });

    return {
      total: count,
      rows: filas.map((fila) => ({
        id: String(fila.id),
        language: fila.language,
        source: fila.source,
        datasetCode: fila.datasetCode,
        datasetPage: fila.datasetPage,
        rowCount: fila.rowCount,
        durationMs: fila.durationMs,
        status: fila.status,
        errorMessage: fila.errorMessage,
        createdAt: fila.createdAt.toISOString(),
      })),
    };
  }
}
