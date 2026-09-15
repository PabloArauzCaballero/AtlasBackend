# expedientes

La carpeta de archivos de una persona: qué hay dentro, quién puede verlo y quién lo abrió.

## Qué es y qué no es

Este módulo **no guarda bytes nuevos**. Los objetos ya los escriben otros flujos —la evidencia de
identidad, los extractos, lo que deja el Motor— y aquí se organizan, se autorizan y se auditan. La
única excepción es el `manifest.json`, que se firma al enviarse la solicitud.

| | Antes | Con expediente |
|---|---|---|
| Dónde están los archivos de un cliente | repartidos en tres tablas y tres pantallas | un árbol por sujeto |
| Quién puede verlos | quien tenga el rol del endpoint | quien tenga nivel **sobre esa carpeta** |
| Quién los abrió | no se registraba | bitácora append-only, incluidas las lecturas |
| Qué había al decidir | no se podía afirmar | manifiesto firmado al enviarse |

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/expedientes` | Lista de expedientes, con estado y tamaño. |
| `GET` | `/expedientes/:id` | La cabecera: estado, congelado, manifiesto, retención. |
| `GET` | `/expedientes/por-sujeto/:tipo/:id` | El expediente de un cliente, para enlazar desde otra pantalla. |
| `GET` | `/expedientes/:id/nodos` | Los hijos de una carpeta, o la búsqueda en todo el árbol. |
| `GET` | `/expedientes/:id/nodos/:nodoId/contenido` | Los bytes, por la API autenticada. Registra el acceso. |
| `POST` | `/expedientes/:id/carpetas` | Crea una carpeta. |
| `POST` | `/expedientes/:id/subidas` | Emite un ticket firmado para subir directo al almacén. |
| `POST` | `/expedientes/:id/subidas/:ticketId/confirmar` | Verifica lo subido y crea el nodo. |
| `PATCH` | `/expedientes/:id/nodos/:nodoId` | Renombra o mueve. |
| `DELETE` | `/expedientes/:id/nodos/:nodoId` | A la papelera (reversible). |
| `GET` `POST` `DELETE` | `/expedientes/:id/nodos/:nodoId/concesiones` | Quién ve esta carpeta, y por qué. |
| `GET` | `/expedientes/:id/contactos` | Contactos y referencias, compuestos desde la base y enmascarados. |
| `GET` | `/expedientes/:id/actividad` | La bitácora. |

## Lo que gobierna este módulo entero

1. **Los bytes no salen por una URL pública.** El contenido pasa siempre por la API autenticada y
   cada apertura queda registrada. Una URL prefirmada al navegador habría sido más barata y habría
   puesto la foto del carnet de una persona fuera de todo control una vez copiada.

2. **El nivel efectivo es el MAYOR de tres fuentes**, nunca el más cercano: el suelo del rol, lo
   heredado de las carpetas de arriba y lo concedido aquí. Si una concesión pudiera *restar*, el
   acceso dependería del orden en que la base devolviera las filas.

3. **Dos techos que ningún permiso levanta.** Un nodo congelado no admite escritura; un expediente
   purgado sólo admite lectura.

4. **Compartir exige motivo.** Ampliar quién ve datos de un tercero es una decisión, y una decisión
   sin razón registrada no se puede revisar después.

5. **Nada que ya viva en la base se copia al almacén.** Los contactos se componen al pedirlos. Un
   JSON en el bucket habría sido una segunda copia de datos personales que envejece sola, que no
   responde a una rectificación y que hay que acordarse de borrar aparte.

6. **Ante la duda no se borra.** Antes de borrar un objeto se cuentan sus referencias en las otras
   tablas y en el Motor; si el Motor no responde, el objeto se conserva. Un huérfano cuesta unos
   kilobytes; un hueco en la evidencia de una decisión no se repara.

7. **Los ganchos del onboarding no pueden tumbar el onboarding.** Todos corren después del commit y
   toleran fallos: si la carpeta llega tarde, la crea el job de relleno.

Decisión completa en [ADR-0010](../../../docs/adr/0010-expediente-de-archivos-por-sujeto.md);
operación en [docs/operations/expedientes.md](../../../docs/operations/expedientes.md).
