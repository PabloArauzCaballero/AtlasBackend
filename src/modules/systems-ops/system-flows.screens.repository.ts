/**
 * @file Repositorio de la capa de datos: encapsula el acceso a PostgreSQL.
 * @business Esta pieza permite saber qué pantallas del ecosistema se usan de verdad y contra qué llaman.
 * @system lee y escribe el catálogo de pantallas y las corridas observadas por origen.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op, QueryTypes, Transaction } from 'sequelize';
import { SystemScreenCatalogModel } from '../../database/models/system-screen-catalog.model.js';
import { RBAC_DRIFT_SQL, SCREEN_RUNS_LIMIT, SCREEN_RUNS_SQL } from './system-flows.sql.constants.js';

/** Cubeta del tráfico que no declaró cliente. No se atribuye a nadie: se cuenta aparte. */
export const SIN_CLIENTE = '(sin cliente)';
import { ScreenRuns } from './system-flows.verification.util.js';
import { clientesMedidosFuera } from './system-flows.evidence.js';

/**
 * Todo lo que Flujos sabe de las PANTALLAS, separado del repositorio de flujos.
 *
 * No es una división estética: son dos catálogos con ciclos de vida distintos —uno se recarga desde
 * el análisis del código de los backends, el otro desde el de los clientes— y la única consulta que
 * los une (qué se llamó desde dónde) no pertenece a ninguno de los dos por completo. Mantenerlos
 * juntos hacía crecer un fichero que ya estaba en el tope, y el tope existe para esto.
 */
@Injectable()
export class SystemFlowsScreensRepository {
  constructor(@InjectModel(SystemScreenCatalogModel) private readonly screens: typeof SystemScreenCatalogModel) {}

  /**
   * Qué se hizo desde cada pantalla en la ventana, indexado por su ruta.
   *
   * Sólo aparecen las pantallas cuyo cliente DECLARÓ su origen. Una pantalla ausente de este mapa no
   * es una pantalla rota: es una que nadie abrió, o una cuyo cliente todavía no manda la cabecera.
   */
  async screenRuns(windowDays: number): Promise<{ porCliente: Map<string, Map<string, ScreenRuns>>; truncado: boolean }> {
    const rows = await this.screens.sequelize!.query<{
      screen: string;
      client: string | null;
      calls: string;
      failed: string;
      last_at: Date | null;
      routes: Array<{ method: string; path: string; calls: number; failed: number }>;
    }>(SCREEN_RUNS_SQL, {
      type: QueryTypes.SELECT,
      replacements: {
        windowDays: String(windowDays), // Un valor que ningún cliente tiene, para que la lista nunca quede vacía: `NOT IN ()` es un error
        // de sintaxis en PostgreSQL, y tumbaría la verificación el día que todos los midiera este bloque.
        clientesDeOtrosBloques: [...clientesMedidosFuera('ATLAS_BACKEND'), '__ningun_cliente__'],
      },
    });
    // Indexado por CLIENTE y luego por ruta concreta: `/` es una pantalla distinta en cada portal,
    // y sin separar por cliente una visita marcaría verificadas las cinco.
    const out = new Map<string, Map<string, ScreenRuns>>();
    for (const row of rows) {
      // Sin cliente declarado no se puede atribuir a ninguno: se agrupa aparte y no se cruza.
      const cliente = row.client ?? SIN_CLIENTE;
      const porPantalla = out.get(cliente) ?? new Map<string, ScreenRuns>();
      porPantalla.set(row.screen, {
        calls: Number(row.calls),
        failed: Number(row.failed),
        lastAt: row.last_at ? new Date(row.last_at) : null,
        routes: row.routes ?? [],
      });
      out.set(cliente, porPantalla);
    }
    // Si la consulta vino al tope, faltan grupos y no se sabe cuáles: quien decida degradar una
    // pantalla a «no usada» tiene que saberlo, o convertirá un corte en una afirmación falsa.
    return { porCliente: out, truncado: rows.length >= SCREEN_RUNS_LIMIT };
  }

  /**
   * Escribe el desenlace POSITIVO de una pantalla: se usó, y contra qué llamó.
   *
   * `verified_at` se escribe sólo aquí. En la rama de reinicio se refrescaba también, así que una
   * pantalla que nadie abre mostraba «verificada hace un minuto» en cada corrida, que es lo
   * contrario de lo que significa.
   */
  async applyScreenVerification(
    clientCode: string,
    route: string,
    outcome: { verification: string; lastSeenAt: Date | null; observed: Record<string, unknown> },
    tx: Transaction,
  ): Promise<void> {
    await this.screens.update(
      {
        verification: outcome.verification,
        verifiedAt: new Date(),
        lastSeenAt: outcome.lastSeenAt,
        observed: outcome.observed,
      },
      { where: { clientCode, route }, transaction: tx },
    );
  }

  /**
   * Devuelve a UNVERIFIED las pantallas de un cliente que NO aparecieron en la ventana.
   *
   * Dos decisiones que importan:
   *
   * - **No se borra `last_seen_at` ni lo observado.** La primera versión los ponía a nulo, y con eso
   *   se perdía justo lo que se quería poder decir —«esta pantalla lleva medio año sin abrirse»—,
   *   porque los logs de aquella ventana acaban podados y no queda otro sitio donde mirarlo.
   * - **Un solo UPDATE.** Antes era uno por pantalla dentro de la transacción de `verify`: 268
   *   viajes serializados, encima de los 1 029 de los flujos.
   */
  async resetScreensNotSeen(clientCode: string, vistas: readonly string[], tx: Transaction): Promise<number> {
    const [afectadas] = await this.screens.update(
      { verification: 'UNVERIFIED' },
      {
        where: {
          clientCode,
          verification: { [Op.ne]: 'UNVERIFIED' },
          ...(vistas.length ? { route: { [Op.notIn]: [...vistas] } } : {}),
        },
        transaction: tx,
      },
    );
    return afectadas;
  }

  /**
   * Pantallas protegidas por permiso que llaman a endpoints sin permiso, cruzando aristas OBSERVADAS.
   *
   * Sólo se opina de lo que alguien ha usado de verdad: la arista pantalla→endpoint derivada del AST
   * no existe (las llamadas viven en servicios compartidos, no en el fichero de la página), y
   * inventarla daría hallazgos plausibles sobre relaciones que quizá no ocurren.
   */
  rbacDrift(): Promise<
    Array<{
      client_code: string;
      route: string;
      nav_permissions: string[];
      nav_roles: string[];
      method: string;
      path: string;
      flow_id: string;
      roles: string[];
      is_public: boolean;
    }>
  > {
    return this.screens.sequelize!.query(RBAC_DRIFT_SQL, { type: QueryTypes.SELECT });
  }

  /** Los códigos de cliente que hay en el catálogo de pantallas  /** Los códigos de cliente que hay en el catálogo de pantallas, sin suponer cuáles son. */
  async screenClients(): Promise<string[]> {
    const rows = await this.screens.findAll({
      attributes: ['clientCode'],
      group: ['client_code'],
      order: [['clientCode', 'ASC']],
      raw: true,
    });
    return (rows as unknown as Array<{ clientCode: string }>).map((row) => row.clientCode);
  }

  /**
   * Clientes con al menos una pantalla cuyo menú declara permiso o rol. Sólo en ellos hay deriva que medir:
   * un menú que no filtra no puede pedir algo distinto de lo que exige la API.
   */
  async clientsWithMenuGates(): Promise<string[]> {
    const rows = await this.screens.findAll({
      attributes: ['clientCode'],
      where: literal(
        `(jsonb_typeof(nav_permissions) = 'array' AND jsonb_array_length(nav_permissions) > 0) OR (jsonb_typeof(nav_roles) = 'array' AND jsonb_array_length(nav_roles) > 0)`,
      ),
      group: ['client_code'],
      raw: true,
    });
    return (rows as unknown as Array<{ clientCode: string }>).map((row) => row.clientCode).sort();
  }

  /**
   * El denominador de la deriva: pantallas VERIFICADAS con rutas observadas, de los clientes cuya deriva se
   * mide. Sale del catálogo, igual que las filas de la deriva, y no de 30 días de logs recalculados en cada
   * llamada, que además sólo veían lo que llega a AtlasBackend.
   */
  screensWithObservedRoutes(clientCodes: readonly string[]): Promise<number> {
    if (!clientCodes.length) return Promise.resolve(0);
    return this.screens.count({
      where: {
        clientCode: { [Op.in]: [...clientCodes] },
        verification: 'VERIFIED',
        [Op.and]: [literal(`jsonb_typeof(observed_json->'routes') = 'array' AND jsonb_array_length(observed_json->'routes') > 0`)],
      },
    });
  }

  /** Las pantallas de un cliente, con lo mínimo para cruzarlas y escribir su desenlace. */
  screensOfClient(clientCode: string): Promise<SystemScreenCatalogModel[]> {
    return this.screens.findAll({
      where: { clientCode },
      attributes: ['clientCode', 'route', 'verification'],
      order: [['route', 'ASC']],
    });
  }
}
