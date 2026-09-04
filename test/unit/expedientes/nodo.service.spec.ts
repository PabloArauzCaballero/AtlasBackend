import { beforeEach, describe, expect, it } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import { NodoMovimientoService } from '../../../src/modules/expedientes/application/nodo-movimiento.service.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';
import type { ExpedienteNodoModel } from '../../../src/database/models/expediente-nodos.model.js';

/**
 * El árbol del expediente.
 *
 * Lo que se fija son las reglas que, si fallan, no rompen nada visible: un nombre duplicado que
 * sobrescribe la selfie anterior, un movimiento circular que hace desaparecer una carpeta de la
 * pantalla sin borrarla, un renombrado que deja a los hijos apuntando a una ruta que ya no existe.
 * Ninguna de las tres lanza un error en producción; todas pierden archivos.
 */
/**
 * Doble del modelo con sólo los campos que estas reglas leen.
 *
 * El modelo real tiene cincuenta y tantas columnas y ninguna de las otras interviene en decidir si
 * un nombre choca, si un movimiento es circular o si una carpeta arrastra a sus hijos. Copiarlas
 * aquí no probaría nada más y haría ilegible cada caso; el molde se estrecha una sola vez, en la
 * fábrica de abajo.
 */
type Nodo = {
  id: string;
  tenantId: string;
  expedienteId: string;
  parentId: string | null;
  tipo: string;
  nombre: string;
  ruta: string;
  inmutable: boolean;
  borradoEn: Date | null;
};

const actor: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: [] };

function nodo(overrides: Partial<Nodo> = {}): Nodo & ExpedienteNodoModel {
  return {
    id: '1',
    tenantId: '1',
    expedienteId: '10',
    parentId: null,
    tipo: 'carpeta',
    nombre: 'auth',
    ruta: '/auth',
    inmutable: false,
    borradoEn: null,
    ...overrides,
  } as Nodo & ExpedienteNodoModel;
}

describe('NodoService', () => {
  let nodos: Array<Nodo & ExpedienteNodoModel>;
  let actualizaciones: Array<{ id: string; values: Record<string, unknown> }>;
  let service: NodoService;
  let movimiento: NodoMovimientoService;

  beforeEach(() => {
    nodos = [];
    actualizaciones = [];
    const repository = {
      listarHijos: async (input: { parentId: string | null }) =>
        nodos.filter((item) => item.parentId === input.parentId && !item.borradoEn),
      findNodo: async (_t: string, _e: string, id: string) => nodos.find((item) => item.id === id) ?? null,
      findNodoPorRuta: async (_t: string, _e: string, ruta: string) => nodos.find((item) => item.ruta === ruta) ?? null,
      findSubarbol: async (_t: string, _e: string, ruta: string) =>
        nodos.filter((item) => item.ruta === ruta || item.ruta.startsWith(`${ruta}/`)),
      contarNodosPorClave: async () => 0,
      crearNodo: async (values: Record<string, unknown>) => {
        const creado = { ...nodo(), ...values, id: String(nodos.length + 100) } as Nodo & ExpedienteNodoModel;
        nodos.push(creado);
        return creado;
      },
      actualizarNodo: async (_t: string, id: string, values: Record<string, unknown>) => {
        actualizaciones.push({ id, values });
        const item = nodos.find((candidato) => candidato.id === id);
        if (item) Object.assign(item, values);
      },
      registrar: async () => undefined,
    } as unknown as ExpedientesRepository;

    const sequelize = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(undefined) };
    service = new NodoService(repository, sequelize as never);
    // Renombrar, mover y la papelera viven en su propio servicio: son las tres operaciones que
    // tocan varias filas a la vez, y por eso salieron de `NodoService`.
    movimiento = new NodoMovimientoService(repository, service, sequelize as never);
  });

  describe('validarNombre', () => {
    it('rechaza separadores de ruta, control y los nombres reservados', () => {
      for (const malo of ['a/b', 'a\\b', '.', '..', '', ' ', 'x'.repeat(256)]) {
        expect(() => service.validarNombre(malo)).toThrow(BadRequestException);
      }
    });

    it('acepta un nombre normal y le quita los espacios de los bordes', () => {
      expect(service.validarNombre('  anverso.jpg  ')).toBe('anverso.jpg');
    });
  });

  describe('nombres duplicados', () => {
    it('no sobrescribe: el sufijo va ANTES de la extensión, como en un Drive', async () => {
      // El cliente que vuelve a subir la selfie porque la primera salió movida. Sobrescribir
      // habría borrado la evidencia de lo que subió primero, que es lo que un expediente conserva.
      nodos.push(nodo({ id: '1', tipo: 'carpeta', nombre: 'auth', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', tipo: 'archivo', nombre: 'selfie.jpg', ruta: '/auth/selfie.jpg', parentId: '1' }));

      const creado = await service.crearCarpeta({
        tenantId: '1',
        expedienteId: '10',
        parentId: '1',
        nombre: 'selfie.jpg',
        actor,
      });
      // `selfie (1).jpg` y no `selfie.jpg (1)`: el archivo tiene que seguir abriéndose con el
      // programa correcto, y eso lo decide la extensión final.
      expect(creado.nombre).toBe('selfie (1).jpg');
    });

    it('la unicidad no distingue mayúsculas', async () => {
      nodos.push(nodo({ id: '1', tipo: 'carpeta', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', tipo: 'archivo', nombre: 'Anverso.JPG', ruta: '/auth/Anverso.JPG', parentId: '1' }));
      const creado = await service.crearCarpeta({ tenantId: '1', expedienteId: '10', parentId: '1', nombre: 'anverso.jpg', actor });
      expect(creado.nombre).not.toBe('anverso.jpg');
    });
  });

  describe('mover', () => {
    it('rechaza mover una carpeta dentro de sí misma', async () => {
      // Sin esto el subárbol queda desconectado de la raíz: sigue existiendo, con rutas que
      // apuntan a un ciclo, y desaparece de la pantalla sin que nada falle.
      nodos.push(nodo({ id: '1', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', nombre: 'motor', ruta: '/auth/motor', parentId: '1' }));

      await expect(
        movimiento.mover({ tenantId: '1', expedienteId: '10', nodo: nodos[0], destinoId: '2', actor }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reescribe la ruta de TODO el subárbol', async () => {
      nodos.push(nodo({ id: '1', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', nombre: 'motor', ruta: '/auth/motor', parentId: '1' }));
      nodos.push(nodo({ id: '3', tipo: 'archivo', nombre: 'a.jpg', ruta: '/auth/motor/a.jpg', parentId: '2' }));
      nodos.push(nodo({ id: '4', nombre: 'otros', ruta: '/otros', parentId: null }));

      await movimiento.mover({ tenantId: '1', expedienteId: '10', nodo: nodos[0], destinoId: '4', actor });

      expect(nodos.find((item) => item.id === '1')?.ruta).toBe('/otros/auth');
      expect(nodos.find((item) => item.id === '2')?.ruta).toBe('/otros/auth/motor');
      // El nieto también: si sólo se recalculara el hijo directo, el archivo quedaría apuntando a
      // una carpeta que ya no existe y la herencia de permisos dejaría de encontrar sus ancestros.
      expect(nodos.find((item) => item.id === '3')?.ruta).toBe('/otros/auth/motor/a.jpg');
    });
  });

  describe('congelado', () => {
    it('un nodo inmutable no se renombra, no se mueve y no se borra', async () => {
      const congelado = nodo({ id: '1', inmutable: true, tipo: 'archivo', nombre: 'manifest.json', ruta: '/manifest.json' });
      nodos.push(congelado);
      const entrada = { tenantId: '1', expedienteId: '10', nodo: congelado, actor };
      await expect(movimiento.renombrar({ ...entrada, nombre: 'otro.json' })).rejects.toBeInstanceOf(ConflictException);
      await expect(movimiento.mover({ ...entrada, destinoId: null })).rejects.toBeInstanceOf(ConflictException);
      await expect(movimiento.borrar(entrada)).rejects.toBeInstanceOf(ConflictException);
    });

    it('una carpeta con un hijo congelado tampoco se borra', async () => {
      // Borrar la carpeta padre sería una forma indirecta de sacar de la vista lo que se congeló.
      nodos.push(nodo({ id: '1', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', tipo: 'archivo', nombre: 'x.jpg', ruta: '/auth/x.jpg', parentId: '1', inmutable: true }));
      await expect(
        movimiento.borrar({ tenantId: '1', expedienteId: '10', nodo: nodos[0], actor }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('papelera', () => {
    it('borrar una carpeta arrastra su contenido', async () => {
      nodos.push(nodo({ id: '1', ruta: '/auth', parentId: null }));
      nodos.push(nodo({ id: '2', tipo: 'archivo', nombre: 'x.jpg', ruta: '/auth/x.jpg', parentId: '1' }));
      const movidos = await movimiento.borrar({ tenantId: '1', expedienteId: '10', nodo: nodos[0], actor });
      expect(movidos).toBe(2);
      expect(nodos.every((item) => item.borradoEn !== null)).toBe(true);
    });

    it('restaurar con la carpeta de origen borrada devuelve el nodo a la raíz', async () => {
      // La alternativa —negarse— deja al operador sin salida: para recuperar el archivo tendría
      // que restaurar antes una carpeta que quizá purgó a propósito.
      nodos.push(nodo({ id: '1', ruta: '/auth', parentId: null, borradoEn: new Date() }));
      const archivo = nodo({ id: '2', tipo: 'archivo', nombre: 'x.jpg', ruta: '/auth/x.jpg', parentId: '1', borradoEn: new Date() });
      nodos.push(archivo);

      await movimiento.restaurar({ tenantId: '1', expedienteId: '10', nodo: archivo, actor });
      expect(archivo.parentId).toBeNull();
      expect(archivo.ruta).toBe('/x.jpg');
    });
  });
});
