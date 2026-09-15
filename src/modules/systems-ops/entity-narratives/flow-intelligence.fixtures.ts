/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system describe las tablas de Flujos (Flow Intelligence): el mapa derivado del código de pantallas, endpoints, permisos y hallazgos.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Flujos: caché consultable del artefacto que `flows:derive` saca del código de los cinco clientes y los cuatro bloques (schema `platform_ops`). */
export const FLOW_INTELLIGENCE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'system_flow_catalog',
    whyExists:
      'Es la respuesta a «¿qué puede hacer un usuario en Atlas y qué toca cada acción?» sin leer código: una fila por operación HTTP de cada bloque (Backend, Motor, ERP, Dashboards) con quién la llama, con qué rol o permiso se protege, si la nombra algún test, si está en el contrato y qué riesgo tiene. Es el nivel base sobre el que se construye el grafo de flujos.',
    whyNotDelete:
      'Se puede vaciar sin perder nada, porque se regenera desde el commit analizado: la fuente de verdad es el código. Lo que se pierde al borrarla es la capacidad de responder en segundos qué endpoints usa la app y no el portal, qué escrituras son públicas o qué flujos críticos no tiene ningún test, que hoy exige una auditoría manual de días.',
    decisionContribution:
      'Prioriza QA y seguridad con datos: `risk` y `badges` señalan escrituras financieras, de identidad o destructivas; `callers` dice a qué clientes afecta un cambio; `contract_status` y `test_status` muestran dónde el contrato o las pruebas van por detrás del código. Un cambio de endpoint consulta aquí sus flujos afectados antes de decidir la regresión.',
    usageExample:
      'Antes de modificar `PATCH /partner-onboarding/:id`, se filtra por esa ruta y se ve que la llaman el portal y el ERP, que tiene riesgo HIGH y ningún test que la nombre. Se decide escribir la suite HTTP primero y avisar al equipo del ERP, en lugar de descubrirlo en producción.',
    systemsExplanation:
      'Tabla en `platform_ops` con clave natural (`system_code`, `http_method`, `path`) y `flow_id` estable (hash de esa clave) para enlaces profundos y bugs. La escribe `POST /systems/flows/import/endpoints` desde el artefacto `flow-model/{bloque}/derived/endpoints.json`, reemplazando las filas del bloque en una transacción; no lleva borrado lógico a propósito. `risk_basis` declara cómo se calculó el riesgo (hoy por módulo; en fase 2 por tablas escritas). Los tres ejes `discovery`/`verification`/`freshness` son independientes: un flujo puede estar mapeado, roto y desactualizado a la vez.',
  },
  {
    tableName: 'system_screen_catalog',
    whyExists:
      'Es lo que ningún otro catálogo tiene: las pantallas de los clientes (portal interno, portal del Motor, ERP, app del consumidor, tableros) con los permisos y roles que su menú exige. Sin esto, el mapa de flujos empieza en el endpoint y no en lo que ve la persona.',
    whyNotDelete:
      'Es regenerable desde el árbol de páginas de cada cliente, así que borrarla no destruye información; pero sin ella no se puede detectar la deriva entre lo que el menú promete (`nav_permissions`) y lo que el backend exige (`@Roles`, `@InternalPermissions`), que es la causa típica de «veo el botón y me da 403».',
    decisionContribution:
      'Cruzada con `system_flow_catalog` permite decidir si un permiso nuevo del portal está cableado de punta a punta, qué pantallas quedan sin ítem de menú (inalcanzables salvo por URL) y qué clientes hay que probar cuando cambia una ruta.',
    usageExample:
      'Se añade el ítem «Flujos» al menú con `systems.flows.read`. El catálogo muestra la pantalla `/internal/flows` con ese permiso; el cruce confirma que los endpoints `systems/flows/*` lo exigen del lado del backend y que ningún rol lo tiene sin que también tenga el del menú.',
    systemsExplanation:
      'Tabla en `platform_ops` con clave (`client_code`, `route`). La escribe `POST /systems/flows/import/screens` desde `flow-model/{cliente}/derived/screens.json`, reemplazando las filas del cliente. Las rutas van normalizadas (`[id]` → `:id`, grupos de Next.js eliminados). Sólo el portal interno tiene registro de menú con permisos; para los demás clientes `nav_permissions` queda vacío, lo cual es un dato, no un hueco.',
  },
  {
    tableName: 'system_flow_findings',
    whyExists:
      'Guarda lo que los detectores de Flujos encuentran al cruzar código, contrato, clientes y tests: rutas en código que el contrato no documenta, escrituras públicas sin lista blanca, endpoints que ningún cliente llama, escrituras sin test, llamadas del cliente a rutas que no existen. Es la bandeja de entrada de deuda de cableado.',
    whyNotDelete:
      'Los hallazgos que dejan de aparecer se marcan `resolved`, no se borran: el historial de cuándo apareció y cuándo desapareció una escritura pública o una ruta fantasma es evidencia de auditoría. Borrar la tabla borra esa línea de tiempo y obliga a repetir auditorías que ya se hicieron.',
    decisionContribution:
      '`severity` y `kind` ordenan qué se arregla primero (una escritura pública sin roles antes que una ruta sin test); `known_since` evita que un hallazgo ya auditado se presente como nuevo; `status` permite descartar falsos positivos con nombre y apellido en lugar de silenciarlos en el detector.',
    usageExample:
      'El detector marca `POST /internal/identity/manual-review-callback` como escritura pública fuera de la lista blanca y ausente del contrato. Seguridad lo revisa: es un callback entre bloques; se decide protegerlo con un secreto compartido y documentarlo, y el hallazgo pasa a `resolved` en la siguiente carga.',
    systemsExplanation:
      'Tabla en `platform_ops` con `finding_key` único (hash de tipo, bloque y referencia) para que una recarga actualice en lugar de duplicar. La escribe `POST /systems/flows/import/findings` desde `flow-model/{bloque}/derived/findings.json`; tras cada carga se recalcula `findings_count` en `system_flow_catalog` por (`http_method`, `path`). Las reglas de cada detector y sus falsos positivos conocidos viven en el README de la herramienta, no aquí.',
  },
  {
    tableName: 'system_flow_imports',
    whyExists:
      'Registra cada carga del artefacto de Flujos: quién la hizo, cuándo, sobre qué commit y rama de qué bloque o cliente, y cuántas filas entraron, se actualizaron y se retiraron. Es lo que hace que el catálogo derivado sea auditable en lugar de un fichero que alguien subió.',
    whyNotDelete:
      'Sin este registro no se puede saber si el mapa de flujos corresponde al código que está desplegado o a uno de hace tres semanas, ni quién lo regeneró. Es la diferencia entre documentación viva y documentación abandonada.',
    decisionContribution:
      'El `analyzed_commit` por bloque decide si un flujo puede considerarse fresco o `STALE`, y `content_hash` permite comprobar que dos cargas sobre el mismo commit produjeron lo mismo (determinismo del derivador). `rows_removed` alto en una carga es la señal temprana de un artefacto generado desde el repo equivocado.',
    usageExample:
      'Tras un despliegue del ERP, el portal muestra que el último import de `ERP_BACKEND` es de un commit anterior. Se relanza la derivación; el registro nuevo muestra 275 recibidas, 275 actualizadas, 0 retiradas, y el mismo `content_hash` que la corrida de CI: el catálogo vuelve a estar al día y se puede demostrar.',
    systemsExplanation:
      'Tabla en `platform_ops`, sólo inserción, una fila por llamada a `POST /systems/flows/import/*` con `scope` (`endpoints`, `screens`, `findings`). `system_flow_catalog`, `system_screen_catalog` y `system_flow_findings` la referencian por `import_id` con `ON DELETE SET NULL`. `created_by` es el actor del token; la carga exige los roles de gobernanza del catálogo de sistemas.',
  },
];
