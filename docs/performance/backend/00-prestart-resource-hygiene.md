# Higiene de procesos, memoria y recursos antes de arrancar

Fase obligatoria previa a levantar la API, el worker, una suite de pruebas o un benchmark. No se
permite arrancar sobre un entorno cuyo estado no se haya verificado.

## Por qué existe

Una instancia anterior que quedó viva sigue escuchando el puerto, sigue ocupando conexiones del pool
de Postgres y sigue consumiendo memoria. Arrancar encima produce dos síntomas que cuestan horas de
depuración: el código nuevo parece no tener efecto (las peticiones las contesta el proceso viejo) y
cualquier medición de latencia sale contaminada por la carga del proceso fantasma.

## Comandos

| Comando | Qué hace | Falla cuando |
|---|---|---|
| `yarn prestart:diagnose` | Inventario: memoria, CPU, swap, disco, puertos y procesos. No toca nada. | Nunca: observar no es fallar. |
| `yarn prestart:cleanup` | Cierre seguro y acotado de lo que este repositorio dejó vivo. | Un proceso propio sobrevive a `SIGTERM` y `SIGKILL`. |
| `yarn prestart:verify` | La puerta: decide si se puede arrancar. | Ver tabla de códigos de salida. |
| `yarn start:clean` | `diagnose → cleanup → verify → start:dev` encadenados. | Si falla cualquier eslabón, no arranca. |
| `yarn stop:project` | Apagado controlado de API, worker y procesos hijos (mismo motor que `cleanup`). | Igual que `cleanup`. |

Banderas de `cleanup`:

- `--dry-run` — enumera lo que haría sin enviar ninguna señal ni borrar nada.
- `--build-artifacts` — elimina además `dist/` y `coverage/`, para un arranque en frío documentado.

## Códigos de salida de `prestart:verify`

| Código | Significado | Qué hacer |
|---|---|---|
| `0` | Entorno limpio y con capacidad. | Arrancar. |
| `2` | Sobreviven procesos del proyecto. | Volver a ejecutar `cleanup`; si insiste, mirar el PID a mano. |
| `3` | Un puerto del proyecto está ocupado por un proceso ajeno o no identificable. | Cerrarlo manualmente. La herramienta no lo hará (ver más abajo). |
| `4` | El host no tiene margen: memoria, swap o disco. | Liberar recursos antes de medir. |
| `1` | Error inesperado ejecutando la verificación. | Es un bug de la herramienta; reportar con el stack. |

## Cómo se demuestra que un proceso es del proyecto

La regla que gobierna toda la fase: **hacen falta dos señales independientes.**

1. La línea de comandos invoca un entrypoint conocido de Atlas (`dist/src/main.js`,
   `src/worker.ts`, `jest.config.cjs`, `scripts/smoke|stress|perf/…`; la lista completa está en
   `scripts/perf/lib/project-processes.ts`).
2. Su directorio de trabajo real —leído del sistema operativo con `lsof`, no inferido— cae dentro de
   la raíz del repositorio, o la línea de comandos contiene su ruta absoluta.

Con una sola señal no basta, y las dos excepciones explican por qué:

- **Sólo cwd:** tu propia shell, el editor y cualquier `tsc` de otra tarea corren con el cwd en la
  raíz del repo. Matarlos «por pertenecer al proyecto» te cierra la terminal.
- **Sólo comando:** `node dist/src/main.js` es una cadena que existe en decenas de proyectos Node.
  Coincidir por ella mata el backend de otro repositorio abierto en paralelo.

Veredictos posibles y qué habilitan:

| Veredicto | Significa | ¿Se puede terminar? |
|---|---|---|
| `owned` | Las dos señales confirman. | Sí. |
| `foreign` | Prueba positiva de estar fuera (cwd legible fuera de la raíz). | No. |
| `unknown` | No se pudo demostrar (lsof sin permisos, proceso de otro usuario). | **No.** Se reporta y bloquea el arranque. |

`unknown` no es «probablemente sí». Es un estado propio, y la herramienta prefiere fallar el
arranque antes que matar algo que no sabe identificar.

## Qué NO hace esta fase, por decisión

- No mata por nombre de runtime (`node`, `tsx`, `python`): mataría trabajo ajeno.
- No toca contenedores, volúmenes ni bases de datos: ahí viven datos.
- No borra `node_modules`, lockfiles ni cachés globales del gestor de paquetes.
- No ejecuta limpiezas globales tipo `docker system prune -a`.
- Sólo elimina `dist/` y `coverage/`, y únicamente con `--build-artifacts`.

## Escalado de terminación

`SIGTERM` → espera `PERF_SHUTDOWN_GRACE_MS` (8000 ms por defecto) → `SIGKILL`. Los descendientes se
terminan primero, de hoja a raíz, para que el padre no reaparezca reenganchando hijos a medio
cerrar. El `SIGKILL` sólo se envía a procesos `owned` que ya tuvieron su ventana de cortesía.

## Umbrales de capacidad

Ajustables por entorno; los valores por defecto están dimensionados para el arranque real de este
repositorio (Nest + `tsc` + suite Jest), no elegidos al azar.

| Variable | Defecto | Bloquea |
|---|---|---|
| `PERF_MIN_AVAILABLE_MEMORY_MB` | 1536 | Sí |
| `PERF_MAX_SWAP_USED_MB` | 2048 | Sí |
| `PERF_MIN_DISK_FREE_MB` | 2048 | Sí |
| `PERF_MAX_LOAD_PER_CORE` | 1.5 | No (aviso: invalida un benchmark, no un arranque) |
| `PERF_SHUTDOWN_GRACE_MS` | 8000 | — |

## Origen de cada métrica

Ninguna cifra se estima. Cada medida lleva su fuente en la evidencia, porque `os.freemem()` en macOS
informa sólo páginas completamente libres e ignora las inactivas reclamables: reporta «sin memoria»
en una máquina que tiene de sobra.

| Métrica | macOS | Linux | Otras |
|---|---|---|---|
| Memoria disponible | `vm_stat` (free+inactive+speculative+purgeable) | `/proc/meminfo` `MemAvailable` | `os.freemem()`, declarado como subestimación |
| Swap en uso | `sysctl vm.swapusage` | `/proc/meminfo` | no medible |
| Disco | `df -k -P` | `df -k -P` | `df -k -P` |
| Carga | `os.loadavg()` | `os.loadavg()` | no medible en Windows |

Una métrica no medible vale `null` y se reporta como tal. Nunca se rellena con un cero, que se
confundiría con una medición.

## Evidencia

Cada corrida escribe en `artifacts/performance/backend/reports/`:

- `<fase>-<timestamp>.json` — histórico, para comparar antes/después.
- `<fase>-latest.json` — la última corrida.

`artifacts/` está fuera de Git (son datos de una máquina y un instante concretos). En CI se publican
como artefacto del job.

## Verificación de la propia herramienta

Los cuatro caminos se comprobaron en vivo sobre macOS 25.6 el 2026-08-06, con procesos reales:

| Caso | Resultado observado |
|---|---|
| Proceso propio en el puerto 3005 con un hijo | Detectado como `owned`; `cleanup` terminó el árbol completo, incluido el hijo que habría quedado huérfano. |
| `--dry-run` sobre ese mismo proceso | Enumeró padre e hijo, no envió ninguna señal, el proceso siguió vivo. |
| Proceso que ignora `SIGTERM` | Escaló a `SIGKILL` tras la ventana de cortesía (2008 ms con `PERF_SHUTDOWN_GRACE_MS=2000`). |
| Proceso ajeno (cwd `/private/tmp`) ocupando el 3005 | Clasificado `foreign`, **no** se tocó; `verify` salió con código 3 y nombró el PID. |
