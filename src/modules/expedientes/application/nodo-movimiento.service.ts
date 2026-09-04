/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Mover un archivo de carpeta y recuperarlo de la papelera sin perderlo por el camino.
 * @system reescribe la ruta materializada del subárbol en una transacción; papelera reversible.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { InjectConnection } from '@nestjs/sequelize';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { NodoService } from './nodo.service.js';
import type { ActorExpediente } from '../expedientes.types.js';
import type { ExpedienteNodoModel } from '../../../database/models/index.js';

/**
 * Las operaciones que MUEVEN un nodo ya existente.
 *
 * Están separadas de `NodoService` —que crea y lee— porque son las tres únicas que tocan varias
 * filas a la vez y necesitan transacción: mover reescribe la ruta de todos los descendientes, y
 * borrar arrastra el subárbol entero. Renombrar entra aquí por lo mismo: cambiar el nombre de una
 * carpeta obliga a reescribir la ruta de todo lo que cuelga de ella. Es también la mitad del árbol
 * donde un fallo no se ve: nada lanza un error, simplemente unos archivos dejan de aparecer en la
 * pantalla.
 */
@Injectable()
export class NodoMovimientoService {
  constructor(
    private readonly repository: ExpedientesRepository,
    private readonly nodos: NodoService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async renombrar(input: {
    tenantId: string;
    expedienteId: string;
    nodo: ExpedienteNodoModel;
    nombre: string;
    actor: ActorExpediente;
  }): Promise<void> {
    if (input.nodo.inmutable) throw new ConflictException('EXPEDIENTE_NODO_CONGELADO');
    const nombre = await this.nodos.nombreLibre(
      input.tenantId,
      input.expedienteId,
      input.nodo.parentId,
      this.nodos.validarNombre(input.nombre),
    );
    const anterior = input.nodo.ruta;
    const rutaPadre = anterior.slice(0, anterior.lastIndexOf('/'));
    const nueva = this.nodos.rutaDe(rutaPadre, nombre);

    await this.reasignarSubarbol(input.tenantId, input.expedienteId, input.nodo, { nombre, ruta: nueva, parentId: input.nodo.parentId });
    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodo.id,
      accion: 'renombrar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { de: anterior, a: nueva },
    });
  }

  async mover(input: {
    tenantId: string;
    expedienteId: string;
    nodo: ExpedienteNodoModel;
    destinoId: string | null;
    actor: ActorExpediente;
  }): Promise<void> {
    if (input.nodo.inmutable) throw new ConflictException('EXPEDIENTE_NODO_CONGELADO');
    const destino = input.destinoId ? await this.nodos.obtenerNodo(input.tenantId, input.expedienteId, input.destinoId) : null;
    if (destino && destino.tipo !== 'carpeta') throw new BadRequestException('EXPEDIENTE_DESTINO_NO_ES_CARPETA');

    /*
     * Un nodo no puede moverse dentro de sí mismo.
     *
     * Sin esta comprobación el subárbol queda desconectado de la raíz —sigue existiendo, con
     * rutas que apuntan a un ciclo— y desaparece de la pantalla sin que nada falle. Se detecta
     * por prefijo de ruta, que es lo mismo que comprobar la ascendencia sin recorrerla.
     */
    if (destino && (destino.ruta === input.nodo.ruta || destino.ruta.startsWith(`${input.nodo.ruta}/`))) {
      throw new ConflictException('EXPEDIENTE_MOVIMIENTO_CIRCULAR');
    }

    await this.nodos.validarCabida(input.tenantId, input.expedienteId, destino);
    const nombre = await this.nodos.nombreLibre(input.tenantId, input.expedienteId, destino?.id ?? null, input.nodo.nombre);
    const anterior = input.nodo.ruta;
    const nueva = this.nodos.rutaDe(destino?.ruta ?? '', nombre);

    await this.reasignarSubarbol(input.tenantId, input.expedienteId, input.nodo, { nombre, ruta: nueva, parentId: destino?.id ?? null });
    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodo.id,
      accion: 'mover',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { de: anterior, a: nueva },
    });
  }

  /**
   * Cambia el nodo y REESCRIBE la ruta de todos sus descendientes, en una transacción.
   *
   * Es el precio de tener la ruta materializada, y se paga aquí una vez en lugar de pagar un
   * recorrido recursivo en cada lectura del árbol. Fuera de la transacción, un fallo a mitad
   * dejaría hijos apuntando a una ruta de padre que ya no existe: visibles en la base, invisibles
   * en la pantalla.
   */
  private async reasignarSubarbol(
    tenantId: string,
    expedienteId: string,
    nodo: ExpedienteNodoModel,
    cambios: { nombre: string; ruta: string; parentId: string | null },
  ): Promise<void> {
    /*
     * La ruta anterior se captura ANTES de tocar nada.
     *
     * Los hijos se recalculan cortando el prefijo viejo, así que leer `nodo.ruta` después de
     * actualizarlo daba el prefijo NUEVO y dejaba a los nietos con la ruta del padre. En producción
     * no se veía —`Model.update` no muta la instancia que se le pasa— y por eso importa no
     * depender de ese detalle: el día que alguien use `instance.save()` el árbol se rompe en
     * silencio.
     */
    const rutaAnterior = nodo.ruta;
    const descendientes = (await this.repository.findSubarbol(tenantId, expedienteId, rutaAnterior)).filter(
      (item) => item.id !== nodo.id,
    );
    // Las rutas de los hijos también se leen antes: el mismo motivo.
    const nuevasRutas = descendientes.map((hijo) => ({ id: hijo.id, ruta: `${cambios.ruta}${hijo.ruta.slice(rutaAnterior.length)}` }));

    await this.sequelize.transaction(async (transaction) => {
      await this.repository.actualizarNodo(tenantId, nodo.id, cambios, transaction);
      for (const hijo of nuevasRutas) {
        await this.repository.actualizarNodo(tenantId, hijo.id, { ruta: hijo.ruta }, transaction);
      }
    });
  }

  /** A la papelera. Carpetas: con todo lo que llevan dentro. */
  async borrar(input: {
    tenantId: string;
    expedienteId: string;
    nodo: ExpedienteNodoModel;
    actor: ActorExpediente;
  }): Promise<number> {
    if (input.nodo.inmutable) throw new ConflictException('EXPEDIENTE_NODO_CONGELADO');
    const subarbol = await this.repository.findSubarbol(input.tenantId, input.expedienteId, input.nodo.ruta);
    const congelado = subarbol.find((item) => item.inmutable);
    if (congelado) throw new ConflictException('EXPEDIENTE_NODO_CONGELADO');

    const ahora = new Date();
    await this.sequelize.transaction(async (transaction) => {
      for (const item of subarbol) {
        await this.repository.actualizarNodo(
          input.tenantId,
          item.id,
          { borradoEn: ahora, borradoPorId: input.actor.id },
          transaction,
        );
      }
    });

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodo.id,
      accion: 'borrar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { ruta: input.nodo.ruta, nodos: subarbol.length },
    });
    return subarbol.length;
  }

  async restaurar(input: {
    tenantId: string;
    expedienteId: string;
    nodo: ExpedienteNodoModel;
    actor: ActorExpediente;
  }): Promise<void> {
    if (!input.nodo.borradoEn) throw new ConflictException('EXPEDIENTE_NODO_NO_ESTA_EN_PAPELERA');

    /*
     * Si la carpeta de origen ya no está, el nodo vuelve a la raíz.
     *
     * La alternativa —negarse a restaurar— deja al operador sin salida: para recuperar el archivo
     * tendría que restaurar antes una carpeta que quizá purgó a propósito. Volver a la raíz es lo
     * que hace cualquier papelera, y la ruta queda visible para que se pueda recolocar.
     */
    const padre = input.nodo.parentId
      ? await this.repository.findNodo(input.tenantId, input.expedienteId, input.nodo.parentId)
      : null;
    const padreVivo = padre && !padre.borradoEn ? padre : null;
    const nombre = await this.nodos.nombreLibre(input.tenantId, input.expedienteId, padreVivo?.id ?? null, input.nodo.nombre);

    await this.repository.actualizarNodo(input.tenantId, input.nodo.id, {
      borradoEn: null,
      borradoPorId: null,
      parentId: padreVivo?.id ?? null,
      nombre,
      ruta: this.nodos.rutaDe(padreVivo?.ruta ?? '', nombre),
    });

    await this.repository.registrar({
      tenantId: input.tenantId,
      expedienteId: input.expedienteId,
      nodoId: input.nodo.id,
      accion: 'restaurar',
      actorTipo: input.actor.tipo,
      actorId: input.actor.id,
      detalle: { ruta: this.nodos.rutaDe(padreVivo?.ruta ?? '', nombre), volvioALaRaiz: !padreVivo },
    });
  }
}
