/**
 * @file Las cinco instrumentaciones automáticas de este backend, elegidas una a una.
 * @business Esta pieza reduce el tiempo de detección y recuperación de incidentes.
 * @system parchea http, express, pg, ioredis y undici sin capturar cabeceras ni valores.
 */
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { Span } from '@opentelemetry/api';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation, type UndiciRequest } from '@opentelemetry/instrumentation-undici';
import { ATTR_DB_QUERY_TEXT } from '@opentelemetry/semantic-conventions';
import { redactSqlLiterals } from './sql-redaction.js';
import { UNTRACED_HTTP_PATH_SUFFIXES } from './telemetry.constants.js';
import type { TelemetryConfig } from './telemetry.types.js';

/**
 * No se usa `auto-instrumentations-node`: habilita más de cuarenta parches —`fs`, `dns`, `net`,
 * `winston`, `graphql`…— de los que este backend sólo necesita cinco. El resto son spans por
 * cada lectura de fichero y cada resolución de nombre, que entierran la operación de negocio
 * bajo ruido y cuestan latencia en el camino caliente. Aquí se declara exactamente lo que hay:
 *
 * | Instrumentación | Qué cubre en este backend |
 * | --- | --- |
 * | `http` | Peticiones entrantes al API y a la sonda del worker; salientes por `http`/`https` |
 * | `express` | Enrutado y middleware bajo NestJS |
 * | `pg` | Toda consulta de Sequelize: el ORM habla por el driver `pg` |
 * | `ioredis` | Rate limiting, locks de jobs, cachés e idempotencia |
 * | `undici` | `fetch` global: Motor de decisiones, MinIO y proveedores externos |
 *
 * **No hay instrumentación de Sequelize a propósito.** El ORM emite sus consultas por `pg`, que
 * ya está instrumentado: añadir la de Sequelize —que además no es un paquete oficial— duplicaría
 * cada consulta en dos spans que describen la misma llamada.
 *
 * Los parámetros de los hooks van anotados EXPLÍCITAMENTE y no por inferencia contextual. Si el
 * árbol acaba con dos copias de `@opentelemetry/instrumentation` —lo que ocurre en cuanto una
 * instrumentación pide un minor distinto, porque para una versión 0.x el cursor `^` no lo
 * cruza—, cada copia declara su propio `InstrumentationConfig` y TypeScript pierde el tipo
 * contextual con TS7006 sobre parámetros que nadie ha tocado. El síntoma es desconcertante:
 * compila en una máquina de desarrollo con `node_modules` incremental y FALLA en la instalación
 * limpia del contenedor. Las anotaciones hacen este archivo inmune a esa divergencia.
 */
export function buildInstrumentations(config: TelemetryConfig): Instrumentation[] {
  const exporterTarget = parseExporterTarget(config.tracesEndpoint);

  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request: IncomingMessage) => isUntracedPath(request.url),
      // El exportador OTLP habla por el módulo `http`. Sin esta exclusión, exportar un lote de
      // spans genera un span, cuya exportación genera otro: un bucle que se retroalimenta y que
      // sólo se nota cuando el colector ya está saturado.
      ignoreOutgoingRequestHook: (request: RequestOptions) => isExporterRequest(request, exporterTarget),
      // Deliberadamente SIN `headersToSpanAttributes`: capturar cabeceras traería
      // `authorization`, `cookie` y `x-api-key` al sistema de trazas.
    }),
    new ExpressInstrumentation({
      /*
       * Sin spans por capa de middleware.
       *
       * Medido el 2026-09-18 sobre `POST /api/v1/auth/login`: de 18 spans, SIETE eran middleware
       * (`helmet`, `cors`, `compression`, dos parseadores y dos anónimos) y cinco de ellos
       * duraban 0,0 ms. Son coste fijo por petición y esconden los seis spans que sí explican
       * algo. La regla de esta fase es que una traza tiene que poder leerse, no que lo tenga todo.
       *
       * Lo único que se pierde es el coste del parseo del cuerpo (8,7 ms en esa medición), y no
       * se pierde del todo: sigue visible como el hueco entre el inicio del span del servidor y
       * el del manejador. Si alguna vez hace falta el detalle, se quita esta línea.
       */
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
    }),
    // `enhancedDatabaseReporting: false` deja fuera los valores de los parámetros LIGADOS, pero
    // NO basta: Sequelize incrusta literales en el texto de algunas consultas y ese texto es
    // `db.statement`. El hook lo reescribe sin contenido. Ver `sql-redaction.ts`.
    new PgInstrumentation({
      enhancedDatabaseReporting: false,
      // Sobrescribe el MISMO atributo que fija la instrumentación (`db.query.text` desde
      // `instrumentation-pg@0.74`; antes se llamaba `db.statement`). Si el nombre volviera a
      // cambiar al subir de versión, la prueba E2E de fuga lo caza: busca el dato, no la clave.
      requestHook: (span: Span, info: { query: { text?: string } }) => {
        const text = info.query.text;
        if (typeof text === 'string') span.setAttribute(ATTR_DB_QUERY_TEXT, redactSqlLiterals(text));
      },
    }),
    new IORedisInstrumentation({
      // El valor almacenado nunca entra en el span: los argumentos de un `SET` de caché con
      // ámbito de inquilino bastarían para filtrar su contenido. Sólo el nombre del comando.
      dbStatementSerializer: (command: string) => command,
    }),
    new UndiciInstrumentation({
      ignoreRequestHook: (request: UndiciRequest) => isUntracedPath(request.path),
    }),
  ];
}

/** Compara por SUFIJO: la API monta las sondas bajo `/api/v1` y el worker sin prefijo. */
function isUntracedPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  if (path === '') return false;
  return UNTRACED_HTTP_PATH_SUFFIXES.some((suffix) => path === suffix || path.endsWith(suffix));
}

type ExporterTarget = Readonly<{ host: string; port: string }>;

/** Destino del exportador, para poder reconocer —y no trazar— sus propias peticiones. */
function parseExporterTarget(endpoint: string | undefined): ExporterTarget | undefined {
  if (endpoint === undefined) return undefined;
  try {
    const url = new URL(endpoint);
    return { host: url.hostname, port: url.port };
  } catch {
    // Un endpoint ilegible ya lo señala el exportador al arrancar; aquí sólo significa que no se
    // puede excluir por destino, nunca un fallo de arranque.
    return undefined;
  }
}

/** `RequestOptions` de Node admite `null` en host y hostname, de ahí la firma ancha. */
function isExporterRequest(
  request: {
    host?: string | null | undefined;
    hostname?: string | null | undefined;
    port?: number | string | null | undefined;
  },
  target: ExporterTarget | undefined,
): boolean {
  if (target === undefined) return false;
  const host = request.hostname ?? request.host ?? '';
  const port = String(request.port ?? '');
  return host.split(':')[0] === target.host && (target.port === '' || port === target.port);
}
