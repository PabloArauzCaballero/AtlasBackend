/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** El expediente de archivos de una persona: árbol, permisos por carpeta y bitácora (schema `expedientes`). */
export const EXPEDIENTE_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'expedientes',
    whyExists:
      'Es la carpeta de una persona. Sus archivos existían repartidos entre la evidencia de identidad, los extractos y lo que dejó el Motor; ninguna tabla decía "esto es todo lo que hay sobre este cliente", así que revisar un caso empezaba por reunirlo a mano y en la práctica se decidía sin abrirlo.',
    whyNotDelete:
      'Es lo que permite afirmar QUÉ había cuando se decidió. Guarda el momento del envío (`enviado_en`), el manifiesto firmado de ese momento y la retención aplicable. Sin la fila, quedan objetos sueltos en un bucket sin dueño declarado ni fecha de caducidad, y una solicitud de supresión no tiene por dónde empezar.',
    decisionContribution:
      'Su `estado` dice si el material sigue creciendo o quedó congelado, y eso cambia cómo se lee todo lo demás: un expediente congelado con manifiesto sostiene una decisión ante un tercero; uno abierto todavía no. La ausencia de manifiesto es señal de que el expediente se reconstruyó a posteriori y no se observó el momento del envío.',
    usageExample:
      'Un analista abre un caso en revisión humana seis meses después de la aprobación. El expediente está congelado y su manifiesto firmado enumera catorce archivos con sus hashes: los mismos que se ven hoy. La decisión se puede defender con el material a la vista.',
    systemsExplanation:
      'Tabla en el schema `expedientes`, con un expediente por sujeto y tenant (`subject_type`, `subject_id`). Referencia la sesión de onboarding por la que se abrió, guarda la clave del `manifest.json` y la fecha de purga. No almacena bytes: los objetos viven en el almacén compatible con S3 y los apuntan los nodos.',
  },
  {
    tableName: 'expediente_nodos',
    whyExists:
      'Es el árbol: carpetas y archivos con nombre y ruta que una persona puede recorrer. El carnet y la selfie en `auth`, los extractos en `extractos`, lo del Motor en su carpeta. Sin él, los archivos de un cliente son una lista de claves de objeto que sólo un ingeniero sabe leer.',
    whyNotDelete:
      'La fila sobrevive incluso a la purga de los bytes, y es deliberado: hay que poder demostrar qué había y qué se borró. Guarda además el `sha256` con el que se puede afirmar que el archivo que se mira es byte a byte el que subió la persona.',
    decisionContribution:
      'El `origen` distingue lo que aportó el cliente de lo que generó el sistema —confundirlos convierte un documento generado en evidencia aportada—. `objeto_ausente` distingue "el archivo se perdió del almacén" de "el cliente no lo subió", que son conclusiones opuestas sobre el mismo hueco. `inmutable` marca lo congelado al enviarse.',
    usageExample:
      'Un revisor ve un aviso en un archivo de `auth`: la ficha existe pero el objeto ya no está en el almacén. En vez de concluir que falta documentación del cliente, abre una incidencia para averiguar cuándo desapareció el objeto.',
    systemsExplanation:
      'Ruta materializada (`ruta`) más `parent_id`: mover o renombrar reescribe la ruta de todo el subárbol en una transacción, y a cambio leer una carpeta o resolver la herencia de permisos es una consulta por prefijo, sin recursión. Un nodo `virtual` no tiene objeto: se compone al pedirlo, como el de contactos. Papelera reversible por `borrado_en`.',
  },
  {
    tableName: 'expediente_concesiones',
    whyExists:
      'Es la autorización que un rol no sabe expresar. `@Roles(...)` responde "¿puede este rol entrar a este endpoint?"; la pregunta real es "¿puede esta persona ver la carpeta de ESTE cliente?". Sin esta tabla, quien podía ver un carnet podía ver todos.',
    whyNotDelete:
      'Es la prueba de quién amplió el acceso a datos personales de un tercero, cuándo y por qué. El `motivo` es obligatorio y no es burocracia: seis meses después, "se compartió con fraude" sin más no explica nada, y una revocación no borra la fila —la marca— para que la ampliación quede registrada aunque ya no esté vigente.',
    decisionContribution:
      'El nivel efectivo sobre una carpeta es el MAYOR entre el suelo del rol, lo heredado de las carpetas de arriba y lo concedido aquí. Es lo que decide si la pantalla ofrece descargar, compartir o purgar, y lo que el backend vuelve a comprobar antes de servir un byte.',
    usageExample:
      'Un analista de fraude necesita ver los extractos de un cliente que no lleva. Un responsable le concede `leer` sobre esa carpeta con el motivo de la investigación abierta y vencimiento a treinta días; al vencer, el acceso desaparece solo y la concesión queda registrada.',
    systemsExplanation:
      'Concesión por nodo y principal (`rol` o `usuario_interno`), con vencimiento opcional. La herencia se resuelve por prefijo de ruta sobre los ancestros del nodo, no por recorrido. Nadie puede conceder un nivel superior al propio ni revocarse su última administración, para que un expediente no quede sin nadie que pueda gobernarlo.',
  },
  {
    tableName: 'expediente_actividad',
    whyExists:
      'Registra qué se hizo con la carpeta de una persona, incluidas las LECTURAS. En un expediente con su cara y su carnet, "quién lo abrió" es tan relevante como "quién lo movió", y es exactamente lo que se pide cuando alguien reclama por el uso de sus datos.',
    whyNotDelete:
      'Es append-only por disparador de base de datos, no por convención: una bitácora que el propio sistema puede reescribir no prueba nada. Sobrevive a la purga del expediente, porque hay que poder demostrar qué se borró y quién lo pidió.',
    decisionContribution:
      'Permite auditar accesos desproporcionados —un analista que abre expedientes de clientes que no lleva— y sostener ante una autoridad que el acceso a datos personales estuvo controlado y registrado, no abierto a todo el equipo.',
    usageExample:
      'Un cliente ejerce su derecho de acceso y pregunta quién ha visto su documentación. La bitácora enumera cada apertura con su actor y su fecha, y las dos ampliaciones de acceso con el motivo que las justificó.',
    systemsExplanation:
      'Tabla append-only en `expedientes`, con disparador que rechaza `UPDATE` y `DELETE`. Cada fila lleva la acción, el actor (interno, cliente o sistema), el nodo afectado y un detalle en JSON ya redactado: nunca guarda el contenido del archivo ni datos personales en claro.',
  },
  {
    tableName: 'expediente_tickets_subida',
    whyExists:
      'Es el permiso acotado para escribir UN objeto en el almacén: un tipo, un tamaño y unos minutos. Sin él, subir un archivo obligaría a que los bytes pasaran dos veces por el backend, convirtiéndolo en un proxy de archivos.',
    whyNotDelete:
      'Es lo que ata lo que se autorizó con lo que llegó. La confirmación descarga el objeto y comprueba hash, tamaño y firma mágica contra lo declarado en el ticket; sin la fila no hay contra qué comparar, y un objeto escrito y no confirmado quedaría huérfano sin que nadie supiera de dónde vino.',
    decisionContribution:
      'Es la compuerta que impide que entre al expediente algo distinto de lo que la persona eligió. Si la verificación falla, el objeto se borra y el archivo nunca queda a medias: el expediente no puede decir que un documento está cuando no está.',
    usageExample:
      'Un operador sube un extracto de 8 MB. El ticket firma tipo y tamaño; el navegador escribe directo en el almacén; el backend recalcula el SHA-256 y detecta que no coincide con el declarado. El objeto se borra y la pantalla pide subirlo de nuevo.',
    systemsExplanation:
      'Ticket de vida corta (`EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS`) con la clave de destino y las cabeceras firmadas que el cliente debe repetir tal cual. Se consume al confirmar; los vencidos y su objeto huérfano los recoge el job de limpieza.',
  },
];
