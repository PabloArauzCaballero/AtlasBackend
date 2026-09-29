# Operar el expediente de archivos

Qué hay que saber para encender, vigilar y reparar el expediente por sujeto.
Código: [`src/modules/expedientes/`](../../src/modules/expedientes/). La decisión, en
[ADR-0010](../adr/0010-expediente-de-archivos-por-sujeto.md).

## El interruptor

```dotenv
EXPEDIENTES_ENABLED=true
EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS=600
EXPEDIENTES_TRASH_RETENTION_DAYS=90
```

Estas tres se leen. Otras tres existen en el esquema (`src/config/env.files.schema.ts`) y **hoy nadie
las lee**, así que cambiarlas no cambia nada: `EXPEDIENTES_KEY_PREFIX` (el prefijo de las claves en el
almacén; las claves de los objetos las arma cada gancho con su propia ruta, no con esta variable) y
los topes `EXPEDIENTES_MAX_DEPTH` y `EXPEDIENTES_MAX_CHILDREN` (profundidad y número de hijos del
árbol: no se hacen cumplir en ningún sitio). Están en las plantillas y en los composes para que el
esquema y el despliegue coincidan, no porque hagan efecto. Encender una de ellas exige antes que el
código la lea.

Con `EXPEDIENTES_ENABLED=false` los endpoints responden 503 y los ganchos del onboarding no hacen
nada. El interruptor existe porque este módulo se cuelga de flujos que **no pueden fallar por él**:
un alta de cliente no se cae porque el expediente no se pueda abrir. Todos los ganchos son tolerantes
a fallos y registran el error en vez de propagarlo.

## Qué ocurre solo, y qué no

**Solo ocurren los ganchos.** Cada uno corre dentro del flujo que lo dispara y es tolerante a fallos
(si el expediente no se puede abrir, el flujo sigue y el error queda en el log):

| Cuándo | Qué pasa |
|---|---|
| Empieza un onboarding | Se abre el expediente con sus carpetas base (`auth`, `extractos`, `motor`, `otros`) |
| Se registra evidencia de identidad | El documento aparece en `auth`, apuntando al objeto que ya existe |
| Se revisa un extracto | El PDF aparece en `extractos` |
| El cliente envía la solicitud | El expediente se **congela** y se escribe el `manifest.json` firmado |

**Nada limpia solo.** No existe ningún trabajo programado que borre expedientes, tickets ni papelera:
`limpiar-expedientes` y `backfill-expedientes` no están en el planificador
(`src/modules/runtime-jobs/scheduled-jobs.catalog.ts`) y sólo corren cuando alguien los lanza a mano
(sección siguiente). Mientras nadie los lance, los tickets de subida vencidos, la papelera pasada de
plazo y los expedientes con retención cumplida **se quedan** en la base y en el almacén. Que no haya
job automático es una decisión: borrar evidencia es algo que una persona dispara y revisa, no un
temporizador. Si hace falta que corra con cierta frecuencia, se programa desde fuera (un cron del
operador que llame a la API) y se deja escrito en el runbook del entorno.

## Los dos trabajos manuales

Se lanzan por API con un token de `admin`, `platform_admin` o `system`. Necesitan las cabeceras
`x-tenant-id` y `x-idempotency-key` (una clave nueva por lanzamiento: es lo que impide que un doble clic
del operador lance el lote dos veces). Ninguna pantalla del portal admin ni del ERP los llama.

```bash
# Relleno histórico: crea el expediente de los clientes anteriores a esta función.
curl -XPOST .../api/v1/operations/jobs/backfill-expedientes \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -H "x-idempotency-key: $(uuidgen)"

# Limpieza: tickets vencidos, papelera pasada de plazo y retención cumplida.
curl -XPOST .../api/v1/operations/jobs/limpiar-expedientes \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -H "x-idempotency-key: $(uuidgen)"
```

Los dos son **idempotentes** y trabajan por lotes (la limpieza, de 200 tickets, 200 nodos y 20
expedientes por llamada): se pueden lanzar tantas veces como haga falta hasta que devuelvan cero. Con
`EXPEDIENTES_ENABLED=false` no hacen nada y responden ceros.

El relleno **no escribe manifiesto**. Un manifiesto es la foto de lo que había al enviarse, y esa
foto no se observó; fabricarla ahora sería inventar evidencia con fecha falsa. Los expedientes
rellenados quedan marcados y la pantalla lo dice.

## Los permisos

| Permiso | Qué habilita |
|---|---|
| `expedientes.leer` | Ver el árbol y abrir archivos |
| `expedientes.escribir` | Subir, renombrar, mover, mandar a la papelera |
| `expedientes.compartir` | Conceder acceso a otros, **siempre con motivo** |
| `expedientes.administrar` | Purgar y revocar cualquier concesión |
| `expedientes.pii.revelar` | Ver contactos y referencias sin enmascarar |

El nivel efectivo sobre una carpeta es el **mayor** de: el suelo que da el rol, las concesiones
heredadas de las carpetas de arriba y las concesiones puestas en ella. Dos techos lo limitan y no los
levanta ningún permiso: un nodo **congelado** no admite escritura, y un expediente **purgado** sólo
admite lectura.

`expedientes.pii.revelar` exige además un motivo y deja un registro `revelar_pii` en la bitácora. No
es un permiso que se dé «por si acaso».

## Cuando algo va mal

**«El archivo ya no está en el almacén».** La ficha existe y el objeto no. No es lo mismo que «el
cliente no lo subió», y es lo que hay que averiguar: el nodo queda marcado `objetoAusente` en vez de
fallar al abrirlo, para que se pueda contar cuántos hay antes de que un revisor se tropiece con el
primero.

```sql
SELECT e.subject_id, n.ruta, n.nombre
  FROM expedientes.expediente_nodos n
  JOIN expedientes.expedientes e ON e._id = n.expediente_id
 WHERE n.objeto_ausente IS TRUE AND n.borrado_en IS NULL;
```

**Una subida que no aparece.** El ticket vence a los `EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS`. Si el
PUT llegó y la confirmación no, el objeto queda huérfano y lo recoge la limpieza **cuando alguien la lance** (no corre sola). Si la verificación
lo rechazó (hash distinto, tipo que no coincide, o antivirus **si está encendido**: ver `MALWARE_SCAN_HOST` en [file-services](../architecture/file-services.md)), el backend **borra el objeto** y
responde el motivo: nunca queda a medias en el expediente.

**Una carpeta que nadie puede administrar.** No debería poder ocurrir: nadie puede revocarse a sí
mismo su última concesión de administración. Si aun así pasa, se repara concediendo desde un usuario
con `expedientes.administrar` global.

## Supresión de datos de una persona

`ExpedienteService.purgarPorSujeto` es el punto de entrada. Recorre el expediente y, por cada objeto,
cuenta las referencias que quedan en `expediente_nodos`, `evidence_documents`,
`bank_statement_reviews` y en el Motor. **Ante la duda no borra**: si el Motor no responde, el objeto
se conserva y se reintenta. Un huérfano cuesta unos kilobytes; un hueco en la evidencia de una
decisión no se repara.

Las fichas y la bitácora **sobreviven** a la purga. Es deliberado: hay que poder demostrar qué había
y qué se borró, sin conservar los bytes.
