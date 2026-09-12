/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Responde quién puede ver la carpeta de una persona, no sólo a quién se le dio permiso.
 * @system cruza el catálogo RBAC con las concesiones del nodo para listar a los espectadores reales.
 */
import { Injectable } from '@nestjs/common';
import { InternalPermissionHoldersRepository } from '../../internal-users/internal-permission-holders.repository.js';
import { ExpedientesRepository } from '../repositories/expedientes.repository.js';
import { ExpedienteAccesosRepository } from '../repositories/expediente-accesos.repository.js';
import { nivelMayor, type Nivel } from '../expedientes.types.js';

/** El nivel que da cada permiso del catálogo. Mismo suelo que aplica `ConcesionService`. */
const NIVEL_POR_PERMISO: Readonly<Record<string, Nivel>> = {
  'expedientes.leer': 'leer',
  'expedientes.escribir': 'escribir',
  'expedientes.compartir': 'compartir',
  'expedientes.administrar': 'administrar',
};

/**
 * Los roles cuyo trabajo es decidir sobre riesgo, que son los que entran al Motor de Decisión.
 *
 * No es una lista de cortesía: son las personas que ya ven la evidencia de esta persona desde el
 * Motor —la cara, el carnet, el extracto que sustentan una decisión— y por tanto las que ya la ven
 * aquí. Marcarlas evita la conclusión falsa de que «el expediente sólo lo ve quien aparece
 * compartido».
 */
const ROLES_DE_RIESGO_DEL_MOTOR = ['RISK_ANALYST', 'RISK_MANAGER', 'FRAUD_ANALYST'] as const;

export type Espectador = {
  internalUserId: string;
  nombre: string;
  email: string | null;
  estado: string | null;
  departamento: string | null;
  cargo: string | null;
  roles: string[];
  nivel: Nivel;
  /** De dónde le viene el acceso. Se acumulan: un mismo usuario puede tener las tres. */
  porRol: boolean;
  porConcesionDeRol: boolean;
  porConcesionDirecta: boolean;
  /** Heredado de esta ruta, o `null` si la concesión está puesta en este mismo nodo. */
  heredadaDe: string | null;
  /** Entra al Motor de Decisión por su rol de riesgo. */
  accedeAlMotor: boolean;
};

/**
 * Quién ve este archivo, de verdad.
 *
 * ## Por qué no basta con listar las concesiones
 *
 * La lista de concesiones responde «a quién se le AMPLIÓ el acceso», y casi siempre está vacía: el
 * acceso normal viene del rol, que es el suelo que reparte el catálogo RBAC. Enseñar sólo las
 * concesiones hacía leer «nadie lo ve» sobre un archivo que ve media plantilla de riesgo — que es
 * exactamente la conclusión contraria a la verdadera, y la peor posible sobre la foto del carnet de
 * una persona.
 *
 * ## Cómo se calcula
 *
 * Para cada persona interna con algún permiso de expedientes se toma el mayor entre su suelo por
 * rol, la concesión heredada más alta y la concesión directa. Es la misma suma que hace
 * `ConcesionService.resolver` para el actor de la petición; aquí se hace para todos a la vez, con
 * dos consultas y no una por empleado.
 *
 * Los techos —expediente purgado, nodo congelado— NO se aplican: recortan lo que alguien puede
 * hacer, no si lo ve, y esta pantalla responde quién lo ve.
 */
@Injectable()
export class VisibilidadService {
  constructor(
    private readonly titulares: InternalPermissionHoldersRepository,
    private readonly repository: ExpedientesRepository,
    private readonly accesos: ExpedienteAccesosRepository,
  ) {}

  async quienLoVe(input: { tenantId: string; expedienteId: string; nodoId: string; ruta: string }): Promise<Espectador[]> {
    const ancestros = await this.repository.findAncestros(input.tenantId, input.expedienteId, input.ruta);
    const rutaPorNodo = new Map(ancestros.map((nodo) => [nodo.id, nodo.ruta || '/']));
    const [filas, concesiones] = await Promise.all([
      this.titulares.findHolders(input.tenantId, Object.keys(NIVEL_POR_PERMISO)),
      this.accesos.findConcesionesVigentes(input.tenantId, [...new Set([...rutaPorNodo.keys(), input.nodoId])]),
    ]);

    const espectadores = new Map<string, Espectador>();
    for (const fila of filas) {
      const nivel = NIVEL_POR_PERMISO[fila.permissionCode];
      if (!nivel) continue;
      const existente = espectadores.get(fila.internalUserId);
      if (existente) {
        existente.nivel = nivelMayor(existente.nivel, nivel) as Nivel;
        if (!existente.roles.includes(fila.roleCode)) existente.roles.push(fila.roleCode);
        continue;
      }
      espectadores.set(fila.internalUserId, {
        internalUserId: fila.internalUserId,
        nombre: fila.fullName ?? fila.email ?? `Usuario ${fila.internalUserId}`,
        email: fila.email,
        estado: fila.status,
        departamento: fila.department,
        cargo: fila.jobTitle,
        roles: [fila.roleCode],
        nivel,
        porRol: true,
        porConcesionDeRol: false,
        porConcesionDirecta: false,
        heredadaDe: null,
        accedeAlMotor: false,
      });
    }

    for (const concesion of concesiones) {
      this.aplicarConcesion(espectadores, {
        principalTipo: concesion.principalTipo,
        principalId: concesion.principalId,
        nivel: concesion.nivel as Nivel,
        heredadaDe: concesion.nodoId === input.nodoId ? null : (rutaPorNodo.get(concesion.nodoId) ?? null),
      });
    }

    for (const espectador of espectadores.values()) {
      espectador.accedeAlMotor = espectador.roles.some((rol) => ROLES_DE_RIESGO_DEL_MOTOR.includes(rol as never));
    }

    /*
     * Riesgo primero, y dentro de cada grupo por nivel y nombre.
     *
     * Quien revisa un caso pregunta antes «¿lo ve alguien fuera de riesgo?» que «¿quién lo ve por
     * orden alfabético?». Poner arriba a quien ya entra por el Motor deja el resto de la lista
     * siendo justamente la respuesta a esa pregunta.
     */
    const orden: Nivel[] = ['administrar', 'compartir', 'escribir', 'leer'];
    return [...espectadores.values()].sort((a, b) => {
      if (a.accedeAlMotor !== b.accedeAlMotor) return a.accedeAlMotor ? -1 : 1;
      const porNivel = orden.indexOf(a.nivel) - orden.indexOf(b.nivel);
      return porNivel !== 0 ? porNivel : a.nombre.localeCompare(b.nombre, 'es');
    });
  }

  /** Suma una concesión a los espectadores ya reunidos, sin bajar a nadie de nivel. */
  private aplicarConcesion(
    espectadores: Map<string, Espectador>,
    concesion: { principalTipo: string; principalId: string; nivel: Nivel; heredadaDe: string | null },
  ): void {
    if (concesion.principalTipo === 'rol') {
      for (const espectador of espectadores.values()) {
        if (!espectador.roles.includes(concesion.principalId)) continue;
        espectador.nivel = nivelMayor(espectador.nivel, concesion.nivel) as Nivel;
        espectador.porConcesionDeRol = true;
        espectador.heredadaDe ??= concesion.heredadaDe;
      }
      return;
    }

    /*
     * Una concesión directa puede apuntar a alguien SIN permiso de expedientes por rol: es
     * precisamente para lo que sirve. Ese usuario no vino en la consulta del catálogo, así que se
     * añade aquí con lo poco que se sabe de él —el resto de la ficha no hace falta para decir que
     * lo ve— en vez de desaparecer de la lista.
     */
    const existente = espectadores.get(concesion.principalId);
    if (existente) {
      existente.nivel = nivelMayor(existente.nivel, concesion.nivel) as Nivel;
      existente.porConcesionDirecta = true;
      existente.heredadaDe ??= concesion.heredadaDe;
      return;
    }
    espectadores.set(concesion.principalId, {
      internalUserId: concesion.principalId,
      nombre: `Usuario ${concesion.principalId}`,
      email: null,
      estado: null,
      departamento: null,
      cargo: null,
      roles: [],
      nivel: concesion.nivel,
      porRol: false,
      porConcesionDeRol: false,
      porConcesionDirecta: true,
      heredadaDe: concesion.heredadaDe,
      accedeAlMotor: false,
    });
  }
}
