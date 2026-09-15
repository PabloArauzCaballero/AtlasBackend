/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system conserva el contrato OpenAPI generado en el arranque para que el catálogo lo pueda leer.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * El contrato OpenAPI que ESTE proceso generó de sus propias rutas, guardado para consultarlo desde
 * dentro.
 *
 * Existe porque el catálogo de endpoints necesita una fuente de verdad que viaje con el
 * despliegue. Las dos que había no lo hacen:
 *
 * - `endpoint-discovery.service` escanea `src/modules` con expresiones regulares, y la imagen de
 *   producción sólo copia `dist/` y `src/database`. En un contenedor devuelve `discovered: 0` sin
 *   error: el botón «descubrir endpoints» del portal no descubría nada y lo reportaba como que no
 *   había nada que descubrir.
 * - El YAML versionado en `docs/endpoints/` es un archivo que alguien tiene que acordarse de
 *   regenerar.
 *
 * El documento OpenAPI, en cambio, lo construye `SwaggerModule.createDocument` a partir de los
 * mismos decoradores y esquemas Zod que validan cada petición: si un endpoint cambia su contrato,
 * el documento cambia con él en el siguiente arranque, sin que nadie tenga que acordarse de nada.
 *
 * Se guarda SIEMPRE, aunque `API_DOCS_ENABLED` esté apagado. Lo que esa bandera controla es
 * *publicar* el contrato por HTTP —que es el mapa que un atacante querría— y no tenerlo en memoria.
 * Sin esta separación, apagar la documentación en producción dejaría además al catálogo sin poder
 * describirse a sí mismo.
 */
@Injectable()
export class OpenApiDocumentRegistry {
  private readonly logger = new Logger(OpenApiDocumentRegistry.name);
  private document: OpenAPIObject | null = null;

  set(document: OpenAPIObject): void {
    this.document = document;
    this.logger.log(`Contrato OpenAPI disponible para el catálogo: ${Object.keys(document.paths ?? {}).length} rutas.`);
  }

  /**
   * `null` cuando el proceso no lo generó — el worker, por ejemplo, que no monta rutas HTTP. Quien
   * lo consulta debe decir que no hay contrato, nunca inventar uno vacío: un catálogo con cero
   * endpoints y un catálogo que no se pudo leer exigen acciones opuestas.
   */
  get(): OpenAPIObject | null {
    return this.document;
  }
}
