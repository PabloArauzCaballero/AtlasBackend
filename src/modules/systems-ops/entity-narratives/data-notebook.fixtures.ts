/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Cuaderno de datos: análisis sobre datos gobernados, sin ejecución en servidor (schema `platform_ops`). */
export const DATA_NOTEBOOK_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'data_notebook_query_history',
    whyExists:
      'Registra qué se preguntó desde el cuaderno de datos: el código de cada celda, quién la corrió, sobre qué dataset, cuántas filas devolvió y cuánto tardó. En un backend que abre datos de clientes al análisis, saber quién consultó qué no es telemetría opcional: es la única forma de responder a «¿alguien miró este expediente?» cuando lo pregunten.',
    whyNotDelete:
      'Es el rastro de acceso a datos personales. Borrarlo deja al sistema sin poder demostrar quién consultó qué, que es exactamente lo que se pide tras una filtración o ante una solicitud del titular. Nótese lo que NO guarda: no hay columna donde quepa un resultado. Esa ausencia también hay que preservarla — añadirla convertiría el historial en una segunda copia de los datos, fuera de `read_api`, sin enmascarado y sin caducidad.',
    decisionContribution:
      '`status`, `error_message`, `row_count` y `duration_ms` muestran qué consultas fallan y cuáles pesan, que es lo que decide dónde hace falta un índice o un dataset nuevo. Cruzado con `actor_role`, revela si un perfil está consultando sistemáticamente datos que su función no necesita — una señal de acceso indebido que ningún control de permisos detecta por sí solo.',
    usageExample:
      'Un analista reporta que el cuaderno «va lento». El historial muestra que sus últimas veinte celdas consultan el mismo dataset sin paginar, con 40 000 filas y 9 segundos cada una: el problema es la consulta, no la instancia, y se ve sin haber guardado un solo resultado.',
    systemsExplanation:
      'Tabla append-only en `platform_ops`, indexada por actor y fecha. `source` guarda el CÓDIGO de la celda como texto y nada de este backend lo interpreta ni lo ejecuta: no existe una vía de ejecución en el servidor, y esa es la propiedad de seguridad de la que depende todo el módulo. El tenant es nullable porque el cuaderno también sirve consultas de plataforma que no pertenecen a ningún tenant.',
  },
  {
    tableName: 'data_notebook_documents',
    whyExists:
      'El cuaderno guardado de una persona: sus celdas, en orden, con el resultado que arrojó cada una la última vez que se ejecutó. Es lo que permite retomar un análisis al día siguiente en vez de reescribirlo, y lo que hace que un análisis pueda revisarlo alguien más en lugar de vivir en la pantalla de quien lo hizo.',
    whyNotDelete:
      'Un cuaderno es trabajo acumulado que nadie va a reconstruir de memoria: la secuencia de celdas ES el razonamiento del análisis, y sin ella queda una conclusión sin derivación. Además `cells` contiene resultados ya servidos —filas ENMASCARADAS de `read_api`, nunca dato en claro—, así que la fila también es evidencia de qué se le mostró a quién y cuándo.',
    decisionContribution:
      'Convierte un análisis en algo revisable y repetible: otro analista abre el cuaderno, ve con qué datos y en qué orden se llegó a la conclusión, y puede discutirla en vez de tener que confiar en ella. Los cuadernos guardados también revelan qué preguntas se repiten, que es la mejor señal de qué merece convertirse en un reporte fijo.',
    usageExample:
      'Riesgo guarda el cuaderno con el que analizó la cosecha de marzo. Un mes después alguien cuestiona la cifra: se reabre, se ve exactamente qué celda la produjo y con qué corte de datos, y el resultado guardado aparece rotulado con su fecha para que nadie lo confunda con uno recién calculado.',
    systemsExplanation:
      'Tabla en `platform_ops` con `cells` en JSONB. Como los resultados guardados son una copia fuera de `read_api`, el servicio impone un techo de bytes al guardar y la pantalla rotula cada resultado restaurado con su fecha: un número viejo presentado como actual es peor que no tenerlo. La tabla se escribe y se lee, y nada de su contenido se interpreta en el servidor — el código de las celdas es texto inerte del lado del backend.',
  },
];
