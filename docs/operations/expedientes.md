# Operar el expediente de archivos

Qué hay que saber para encender, vigilar y reparar el expediente por sujeto.
Código: [`src/modules/expedientes/`](../../src/modules/expedientes/). La decisión, en
[ADR-0010](../adr/0010-expediente-de-archivos-por-sujeto.md).

## El interruptor

```dotenv
EXPEDIENTES_ENABLED=true
EXPEDIENTES_KEY_PREFIX=expedientes
EXPEDIENTES_UPLOAD_TICKET_TTL_SECONDS=600
EXPEDIENTES_TRASH_RETENTION_DAYS=90
EXPEDIENTES_MAX_DEPTH=8
EXPEDIENTES_MAX_CHILDREN=2000
```

Con `EXPEDIENTES_ENABLED=false` los endpoints responden 503 y los ganchos del onboarding no hacen
nada. El interruptor existe porque este módulo se cuelga de flujos que **no pueden fallar por él**:
un alta de cliente no se cae porque el expediente no se pueda abrir. Todos los ganchos son tolerantes
a fallos y registran el error en vez de propagarlo.

## Qué ocurre solo

| Cuándo | Qué pasa |
|---|---|
| Empieza un onboarding | Se abre el expediente con sus carpetas base (`auth`, `extractos`, `motor`, `otros`) |
| Se registra evidencia de identidad | El documento aparece en `auth`, apuntando al objeto que ya existe |
| Se revisa un extracto | El PDF aparece en `extractos` |
| El cliente envía la solicitud | El expediente se **congela** y se escribe el `manifest.json` firmado |
| Vence la papelera o la retención | El job de limpieza borra, previo conteo de referencias |

## Los dos trabajos manuales

Se lanzan desde el portal (**Jobs de runtime**) o por API:

```bash
# Relleno histórico: crea el expediente de los clientes anteriores a esta función.
curl -XPOST .../api/v1/runtime-jobs/backfill-expedientes -H "authorization: Bearer $TOKEN"

# Limpieza: tickets vencidos, papelera pasada de plazo y retención cumplida.
curl -XPOST .../api/v1/runtime-jobs/limpiar-expedientes -H "authorization: Bearer $TOKEN"
```

Los dos son **idempotentes** y trabajan por lotes: se pueden lanzar tantas veces como haga falta.

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
PUT llegó y la confirmación no, el objeto queda huérfano y lo recoge la limpieza. Si la verificación
lo rechazó (hash distinto, tipo que no coincide, antivirus), el backend **borra el objeto** y
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
