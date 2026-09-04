/**
 * @file Repositorio: aísla el acceso a datos del resto de la aplicación.
 * @business Guarda y recupera el expediente de una persona y su árbol de archivos.
 * @system encapsula las consultas de expedientes, nodos y actividad.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  ExpedienteActividadModel,
  ExpedienteModel,
  ExpedienteNodoModel,
} from '../../../database/models/index.js';
import type { AccionActividad, EstadoExpediente } from '../expedientes.types.js';

/**
 * El expediente, su árbol y su bitácora.
 *
 * Las tres tablas van juntas porque siempre se consultan juntas: un nodo sin su expediente no se
 * puede autorizar, y ninguna operación sobre el árbol termina sin escribir en la bitácora.
 * Partirlas habría obligado a coordinar tres dependencias en cada método de cada servicio.
 *
 * Lo que SÍ está aparte —en [`ExpedienteAccesosRepository`](./expediente-accesos.repository.ts)—
 * son las concesiones y los tickets de subida: los usan dos servicios cada una, no todos, y
 * tenerlas aquí dejaba el archivo por encima del límite de tamaño sin ganar nada.
 */
@Injectable()
export class ExpedientesRepository {
  constructor(
    @InjectModel(ExpedienteModel) private readonly expedientes: typeof ExpedienteModel,
    @InjectModel(ExpedienteNodoModel) private readonly nodos: typeof ExpedienteNodoModel,
    @InjectModel(ExpedienteActividadModel) private readonly actividad: typeof ExpedienteActividadModel,
  ) {}

  // ---------------------------------------------------------------- expedientes

  async crearExpediente(
    values: {
      tenantId: string;
      subjectType: string;
      subjectId: string;
      sessionId: string | null;
      customerCode: string | null;
      creadoPorTipo: string;
      creadoPorId: string | null;
    },
    transaction?: Transaction,
  ): Promise<ExpedienteModel> {
    return this.expedientes.create({ ...values, estado: 'abierto' }, { transaction });
  }

  findExpediente(tenantId: string, id: string): Promise<ExpedienteModel | null> {
    return this.expedientes.findOne({ where: { tenantId, id } });
  }

  /**
   * El expediente de un sujeto. Con `sessionId`, el de ESA sesión; sin ella, el más reciente.
   *
   * Es la consulta que hace la revisión humana: llega con un `customerId` y necesita la carpeta,
   * sin saber por qué sesión entró el cliente.
   */
  findExpedientePorSujeto(
    tenantId: string,
    subjectType: string,
    subjectId: string,
    sessionId?: string | null,
  ): Promise<ExpedienteModel | null> {
    return this.expedientes.findOne({
      where: { tenantId, subjectType, subjectId, ...(sessionId ? { sessionId } : {}) },
      order: [['created_at', 'DESC']],
    });
  }

  async listarExpedientes(input: {
    tenantId: string;
    subjectType?: string;
    estado?: EstadoExpediente;
    q?: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: ExpedienteModel[]; count: number }> {
    const where: Record<string, unknown> = { tenantId: input.tenantId };
    if (input.subjectType) where.subjectType = input.subjectType;
    if (input.estado) where.estado = input.estado;
    // La búsqueda es por código de cliente o por identificador del sujeto: son los dos datos que
    // alguien tiene delante cuando llega desde un caso o desde un ticket de soporte.
    if (input.q) {
      const patron = `%${input.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      where[Op.or as unknown as string] = [
        { customerCode: { [Op.iLike]: patron } },
        ...(/^\d+$/.test(input.q) ? [{ subjectId: input.q }] : []),
      ];
    }
    return this.expedientes.findAndCountAll({ where, order: [['created_at', 'DESC']], offset: input.offset, limit: input.limit });
  }

  async actualizarExpediente(
    tenantId: string,
    id: string,
    values: Partial<{ estado: EstadoExpediente; enviadoEn: Date; manifestNodoId: string; retencionHasta: Date; purgadoEn: Date }>,
    transaction?: Transaction,
  ): Promise<void> {
    await this.expedientes.update({ ...values, updatedAtValue: new Date() }, { where: { tenantId, id }, transaction });
  }

  /** Expedientes cuya retención venció. Los recoge el job de limpieza. */
  findExpedientesVencidos(limite: number): Promise<ExpedienteModel[]> {
    return this.expedientes.findAll({
      where: { retencionHasta: { [Op.lt]: new Date() }, purgadoEn: null as unknown as Date },
      limit: limite,
    });
  }

  // ---------------------------------------------------------------- nodos

  async crearNodo(
    values: {
      tenantId: string;
      expedienteId: string;
      parentId: string | null;
      tipo: string;
      nombre: string;
      ruta: string;
      origen: string;
      clase?: string | null;
      storageKey?: string | null;
      storageBucket?: string | null;
      sha256?: string | null;
      mimeType?: string | null;
      sizeBytes?: string | null;
      evidenceDocumentId?: string | null;
      engineRequestId?: string | null;
      /** Se compone desde la base al abrirlo; no tiene objeto en el almacén. */
      virtual?: boolean;
      inmutable?: boolean;
      creadoPorTipo: string;
      creadoPorId: string | null;
    },
    transaction?: Transaction,
  ): Promise<ExpedienteNodoModel> {
    return this.nodos.create(values, { transaction });
  }

  findNodo(tenantId: string, expedienteId: string, nodoId: string): Promise<ExpedienteNodoModel | null> {
    return this.nodos.findOne({ where: { tenantId, expedienteId, id: nodoId } });
  }

  findNodoPorRuta(tenantId: string, expedienteId: string, ruta: string): Promise<ExpedienteNodoModel | null> {
    return this.nodos.findOne({ where: { tenantId, expedienteId, ruta, borradoEn: null as unknown as Date } });
  }

  /** Todos los nodos que apuntan a una clave, en cualquier expediente. Lo usa el conteo de referencias. */
  contarNodosPorClave(storageKey: string, excluyendoNodoId?: string): Promise<number> {
    return this.nodos.count({
      where: {
        storageKey,
        ...(excluyendoNodoId ? { id: { [Op.ne]: excluyendoNodoId } } : {}),
      },
    });
  }

  listarHijos(input: {
    tenantId: string;
    expedienteId: string;
    parentId: string | null;
    incluirPapelera: boolean;
    q?: string;
  }): Promise<ExpedienteNodoModel[]> {
    const where: Record<string, unknown> = { tenantId: input.tenantId, expedienteId: input.expedienteId };
    // Con búsqueda se ignora la carpeta: quien escribe en el buscador quiere el archivo, no navegar.
    if (input.q) where.nombre = { [Op.iLike]: `%${input.q.replace(/[%_]/g, (c) => `\\${c}`)}%` };
    else where.parentId = input.parentId;
    if (!input.incluirPapelera) where.borradoEn = null;
    return this.nodos.findAll({
      where,
      order: [
        ['tipo', 'ASC'],
        ['nombre', 'ASC'],
      ],
      limit: 500,
    });
  }

  listarTodosLosNodos(tenantId: string, expedienteId: string, incluirPapelera = false): Promise<ExpedienteNodoModel[]> {
    return this.nodos.findAll({
      where: { tenantId, expedienteId, ...(incluirPapelera ? {} : { borradoEn: null }) },
      order: [['ruta', 'ASC']],
    });
  }

  /**
   * Los ancestros de un nodo, de la raíz hacia él, resueltos por PREFIJO de ruta.
   *
   * Es lo que hace barata la herencia de permisos: una consulta con `IN` sobre una columna indexada
   * en vez de un recorrido recursivo que hace tantas consultas como profundidad tiene el árbol.
   */
  async findAncestros(tenantId: string, expedienteId: string, ruta: string): Promise<ExpedienteNodoModel[]> {
    const partes = ruta.split('/').filter((parte) => parte.length > 0);
    const rutas: string[] = [''];
    let acumulada = '';
    for (const parte of partes.slice(0, -1)) {
      acumulada += `/${parte}`;
      rutas.push(acumulada);
    }
    if (rutas.length === 0) return [];
    return this.nodos.findAll({ where: { tenantId, expedienteId, ruta: { [Op.in]: rutas } }, order: [['ruta', 'ASC']] });
  }

  /** El subárbol de un nodo, por prefijo. Lo usan mover (recalcular rutas) y borrar (recursivo). */
  findSubarbol(tenantId: string, expedienteId: string, ruta: string): Promise<ExpedienteNodoModel[]> {
    return this.nodos.findAll({
      where: { tenantId, expedienteId, [Op.or]: [{ ruta }, { ruta: { [Op.like]: `${ruta.replace(/[%_]/g, (c) => `\\${c}`)}/%` } }] },
      order: [['ruta', 'ASC']],
    });
  }

  async actualizarNodo(
    tenantId: string,
    nodoId: string,
    values: Partial<{
      nombre: string;
      ruta: string;
      parentId: string | null;
      borradoEn: Date | null;
      borradoPorId: string | null;
      inmutable: boolean;
      objetoAusente: boolean;
      storageBucket: string | null;
      sha256: string | null;
      sizeBytes: string | null;
      mimeType: string | null;
      storageKey: string | null;
    }>,
    transaction?: Transaction,
  ): Promise<void> {
    await this.nodos.update({ ...values, updatedAtValue: new Date() }, { where: { tenantId, id: nodoId }, transaction });
  }

  async borrarNodoDefinitivo(tenantId: string, nodoId: string, transaction?: Transaction): Promise<void> {
    await this.nodos.destroy({ where: { tenantId, id: nodoId }, transaction });
  }

  /** Lo que la papelera puede purgar: borrado hace más de `dias`. */
  findPapeleraVencida(dias: number, limite: number): Promise<ExpedienteNodoModel[]> {
    const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    return this.nodos.findAll({ where: { borradoEn: { [Op.lt]: corte } }, limit: limite });
  }

  listarPapelera(tenantId: string, limite: number): Promise<ExpedienteNodoModel[]> {
    return this.nodos.findAll({
      where: { tenantId, borradoEn: { [Op.ne]: null } },
      order: [['borrado_en', 'DESC']],
      limit: limite,
    });
  }

  // ---------------------------------------------------------------- actividad

  async registrar(
    values: {
      tenantId: string;
      expedienteId: string;
      nodoId: string | null;
      accion: AccionActividad;
      actorTipo: string;
      actorId: string | null;
      requestId?: string | null;
      ip?: string | null;
      detalle?: Record<string, unknown>;
    },
    transaction?: Transaction,
  ): Promise<void> {
    await this.actividad.create({ ...values, detalle: values.detalle ?? {} }, { transaction });
  }

  async listarActividad(input: {
    tenantId: string;
    expedienteId: string;
    nodoId?: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: ExpedienteActividadModel[]; count: number }> {
    return this.actividad.findAndCountAll({
      where: { tenantId: input.tenantId, expedienteId: input.expedienteId, ...(input.nodoId ? { nodoId: input.nodoId } : {}) },
      order: [['created_at', 'DESC']],
      offset: input.offset,
      limit: input.limit,
    });
  }

  /** Cuántos archivos abrió una persona en este expediente. Lo usa el aviso del formulario de decisión. */
  contarConsultas(tenantId: string, expedienteId: string, actorId: string): Promise<number> {
    return this.actividad.count({
      where: { tenantId, expedienteId, actorId, accion: { [Op.in]: ['ver', 'descargar'] } },
    });
  }
}
