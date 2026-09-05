/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system guarda, lista, actualiza y borra los cuadernos que escribe cada persona.
 */
import { ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { DataNotebookDocumentModel } from '../../database/models/index.js';
import { DATA_NOTEBOOK_LIMITS } from './data-notebook.constants.js';
import { NotebookDocumentDto } from './data-notebook.schemas.js';

export type NotebookDocumentRow = {
  id: string;
  title: string;
  datasetCode: string | null;
  cells: NotebookDocumentDto['cells'];
  createdAt: string;
  updatedAt: string;
};

export type NotebookDocumentSummary = Omit<NotebookDocumentRow, 'cells'> & { cellCount: number };

/**
 * Los cuadernos de cada persona: crear, listar, abrir, guardar y borrar.
 *
 * Todo se acota por `(_tenant_id, owner_user_id)`, y esa pareja se toma SIEMPRE del token, nunca
 * del cuerpo ni de la ruta. Es lo que hace que «abrir el cuaderno 7» no pueda devolver el cuaderno
 * 7 de otra organización: la consulta no tiene forma de encontrarlo, así que no hay una
 * comprobación de propiedad que alguien pueda olvidarse de escribir en el siguiente endpoint.
 *
 * Se guarda el documento Y el avance: lo que cada celda arrojó la última vez. Un cuaderno que se
 * reabre en blanco no conserva el trabajo, y el trabajo es justamente el resultado.
 *
 * La contrapartida es real y se acota en tres sitios, no en uno: el tope de bytes de aquí abajo,
 * el `savedAt` que la pantalla rotula al restaurar —un número viejo sin fecha junto a datos nuevos
 * es la peor lectura posible— y el enmascarado, que ya venía hecho de `read_api`: lo que se
 * conserva es la copia enmascarada, no el dato en claro. Sigue sin haber ejecución en el servidor:
 * esto se guarda, no se interpreta.
 */
@Injectable()
export class DataNotebookDocumentService {
  constructor(
    @InjectModel(DataNotebookDocumentModel)
    private readonly model: typeof DataNotebookDocumentModel,
  ) {}

  private duenio(user: AuthenticatedUser) {
    return { tenantId: user.tenantId ?? null, ownerUserId: user.sub };
  }

  /**
   * El tope se mide sobre el JSON que va a la fila, no sobre una estimación.
   *
   * Desde que el cuaderno guarda también lo que cada celda arrojó, el peso ya no lo decide el
   * número de celdas: una tabla de veinte mil filas o cuatro gráficos en PNG pesan más que
   * doscientas celdas de código. Y el mensaje dice el tamaño y el techo —no «demasiado grande»—
   * porque lo que hay que hacer después es distinto según por cuánto se pasó: borrar un gráfico o
   * volver a ejecutar con menos filas.
   */
  private comprobarTamanio(body: NotebookDocumentDto): void {
    const bytes = Buffer.byteLength(JSON.stringify(body.cells), 'utf8');
    if (bytes <= DATA_NOTEBOOK_LIMITS.maxNotebookBytes) return;

    const enMegas = (valor: number) => `${(valor / (1024 * 1024)).toFixed(1)} MB`;
    throw new PayloadTooLargeException(
      `El cuaderno ocupa ${enMegas(bytes)} con sus resultados y el techo es ${enMegas(DATA_NOTEBOOK_LIMITS.maxNotebookBytes)}. ` +
        'Borra algún gráfico o vuelve a ejecutar con menos filas por página antes de guardar.',
    );
  }

  async listOwn(user: AuthenticatedUser): Promise<NotebookDocumentSummary[]> {
    const filas = await this.model.findAll({
      where: this.duenio(user),
      order: [['updated_at', 'DESC']],
      limit: DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser,
    });

    // El listado NO devuelve las celdas: con cuadernos largos serían megabytes para pintar una
    // lista de títulos. `cellCount` es lo que hace falta para elegir cuál abrir.
    return filas.map((fila) => ({
      id: String(fila.id),
      title: fila.title,
      datasetCode: fila.datasetCode,
      cellCount: Array.isArray(fila.cells) ? fila.cells.length : 0,
      createdAt: fila.createdAt.toISOString(),
      updatedAt: fila.updatedAt.toISOString(),
    }));
  }

  async create(body: NotebookDocumentDto, user: AuthenticatedUser): Promise<NotebookDocumentRow> {
    this.comprobarTamanio(body);
    const cuantos = await this.model.count({ where: this.duenio(user) });
    if (cuantos >= DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser) {
      // Se dice el número: «has llegado al tope» sin decir cuál obliga a adivinar cuántos borrar.
      throw new ForbiddenException(
        `Has llegado al tope de ${DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser} cuadernos guardados. Borra alguno para crear otro.`,
      );
    }

    const ahora = new Date();
    const fila = await this.model.create({
      ...this.duenio(user),
      title: body.title,
      datasetCode: body.datasetCode ?? null,
      cells: body.cells,
      createdAt: ahora,
      updatedAt: ahora,
    });

    return this.aFila(fila);
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<NotebookDocumentRow> {
    const fila = await this.model.findOne({ where: { ...this.duenio(user), id } });
    if (!fila) throw new NotFoundException(`El cuaderno «${id}» no existe o no es tuyo.`);
    return this.aFila(fila);
  }

  async update(id: string, body: NotebookDocumentDto, user: AuthenticatedUser): Promise<NotebookDocumentRow> {
    this.comprobarTamanio(body);
    const fila = await this.model.findOne({ where: { ...this.duenio(user), id } });
    if (!fila) throw new NotFoundException(`El cuaderno «${id}» no existe o no es tuyo.`);

    fila.title = body.title;
    fila.datasetCode = body.datasetCode ?? null;
    fila.cells = body.cells;
    fila.updatedAt = new Date();
    await fila.save();

    return this.aFila(fila);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<{ deleted: boolean }> {
    const cuantas = await this.model.destroy({ where: { ...this.duenio(user), id } });
    // Borrar algo que no existe NO es un error del cliente: puede ser el segundo clic de alguien
    // impaciente, o el mismo cuaderno borrado en otra pestaña. Se responde con el hecho.
    return { deleted: cuantas > 0 };
  }

  private aFila(fila: DataNotebookDocumentModel): NotebookDocumentRow {
    return {
      id: String(fila.id),
      title: fila.title,
      datasetCode: fila.datasetCode,
      /*
       * Un `cast` en el borde de JSONB, no en medio de la lógica.
       *
       * Lo que Postgres devuelve de una columna JSON es `unknown` por definición: lo escribió una
       * versión anterior de este mismo código y nadie garantiza su forma hoy. El contrato se aplica
       * al ENTRAR (`notebookDocumentSchema`), que es donde puede rechazarse algo; al salir, negarse
       * a devolver un cuaderno viejo por una celda con un campo de más sería perderle el trabajo a
       * su dueño.
       */
      cells: (Array.isArray(fila.cells) ? fila.cells : []) as NotebookDocumentRow['cells'],
      createdAt: fila.createdAt.toISOString(),
      updatedAt: fila.updatedAt.toISOString(),
    };
  }
}
