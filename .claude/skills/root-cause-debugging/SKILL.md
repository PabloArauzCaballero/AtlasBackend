---
name: root-cause-debugging
description: Gate de depuración por causa raíz — ante cualquier fallo obliga a reproducir primero con un repro mínimo, leer el error completo, localizar en la cadena, formular una hipótesis falsable y matarla con el experimento más barato, bisectar, y enunciar la causa antes de tocar código. Prohíbe reintentar hasta que pase, silenciar errores, debilitar o saltear tests. Usar cuando falla un test, un build, un E2E, un endpoint o un flujo; ante un bug reportado; y ante cualquier fallo intermitente.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Depuración por causa raíz

Un fix sin causa identificada es una apuesta. El objetivo no es que el rojo se ponga verde: es
poder escribir **"falla porque X produce Y bajo la condición Z"** y demostrarlo. Hasta tener esa
frase, no se edita código de producción.

## Cuándo aplica

- Cualquier rojo: test, typecheck, build, E2E, request, job, arranque del stack.
- Bug reportado por una persona (ver `bug-reporting-standard` para el formato de entrada).
- Fallo intermitente, aunque "se arregle solo" al re-ejecutar.

## El loop

### 1. Congelar
No cambies nada todavía. Anotá el estado: rama, commit, qué comando, qué datos. Cada edit previo
a entender contamina la escena y te deja sin saber qué arregló qué.

### 2. Reproducir
Ejecutá **una vez** la reproducción y capturá: input, esperado, actual, stack/log/trace completo,
estado de los datos. Después **reducila**: el repro mínimo es el comando más corto que todavía falla
(un test, un request, un registro). Sin repro no hay depuración, hay adivinanza.

Si no reproduce: eso es un dato, no un alivio. Registrá qué difiere (datos, orden, entorno, tiempo,
concurrencia) y seguí por ahí.

### 3. Leer el error completo
- El mensaje entero y el stack hasta **el primer frame de código propio**, no solo la última línea.
- En cascadas, el error que importa es **el primero**; los siguientes suelen ser consecuencia.
- Los `Caused by` / `cause` anidados, los warnings previos, el exit code.
- En E2E: trace, consola del navegador y respuestas de red, no solo el assert que falló.

### 4. Localizar
Seguí la cadena y encontrá el **primer eslabón donde el valor ya está mal**:

```text
UI → request → validación → servicio → persistencia → respuesta → render
```

Partila al medio: ¿el request sale bien? ¿la base quedó bien? Cada observación descarta media cadena.

### 5. Hipótesis falsable + experimento barato
Mantené pocas hipótesis (2–3) y ordenalas por **costo de matarlas**, no por cuánto te gustan.

| Hipótesis | Predice que... | Experimento que la mata | Costo |
|---|---|---|---|
| El filtro de tenant excluye el registro | la query sin filtro lo devuelve | correr la query directa | 1 min |
| El DTO descarta el campo | el body llega sin el campo al servicio | log puntual / breakpoint | 3 min |

Una hipótesis que no predice nada observable no es una hipótesis. Un experimento cambia **una**
variable. Anotá el resultado de cada uno: las hipótesis muertas son evidencia.

### 6. Bisectar cuando "antes andaba"
```bash
git bisect start
git bisect bad                 # el commit actual falla
git bisect good <ref-que-andaba>
git bisect run <comando-repro> # exit 0 = good, distinto de 0 = bad
git bisect reset
```
Bisectá también lo que no es historia: mitad de los datos, mitad de la config, mitad del input,
mitad de los tests que corren antes (contaminación de estado).

### 7. Enunciar la causa
Antes del fix, escribí: **"Falla porque X produce Y bajo la condición Z."**
Criterio de salida: la causa **explica todos los síntomas observados**, incluidos los raros
(por qué solo a veces, por qué solo en ese entorno, por qué desde ese commit). Si queda un síntoma
sin explicar, tenés una causa parcial u otra causa más: seguí.

### 8. Fix mínimo + test de regresión
- El fix elimina X; no oculta Y.
- Escribí el test que **falla antes del fix** y pasa después. Si no podés hacerlo fallar, no está probando la causa.
- Mantené el diff dentro del alcance (ver `scope-discipline`).

### 9. Re-ejecutar
El repro original, el test de regresión y el grupo relacionado. Recién ahí subís el peldaño
(ver `evidence-and-verification`).

## Clasificar la falla

Clasificá **con evidencia**, no por descarte. La clase decide la acción.

| Clase | Evidencia que la sostiene | Acción |
|---|---|---|
| `PRODUCTO` | El comportamiento contradice el requisito | Corregir ya y re-testear |
| `TEST` | El test contradice el requisito, o depende de orden/tiempo/selector frágil | Corregir el test **sin debilitar el requisito** |
| `ENTORNO` | Falla con código que se sabe sano; reproduce al alterar el entorno de forma controlada | Arreglar si está bajo tu control; si no, documentar |
| `DATOS` | El estado de datos viola un supuesto; reproduce con ese dato y no con otro | Corregir en el origen del dato, no a mano en la base |
| `EXTERNO` | El tercero responde mal, comprobado con un request directo | Documentar con evidencia; nunca maquillar como PASS |

"Es el entorno" sin un experimento que lo demuestre es una racionalización (ver `rationalization-guard`).
El detalle de triage de E2E vive en `e2e-failure-triage`.

## Fallos intermitentes

Un intermitente es un bug de **orden, tiempo, concurrencia o estado compartido** hasta demostrar lo
contrario. Corrélo N veces y registrá la tasa; corrélo aislado y en suite; buscá estado que sobrevive
entre tests, relojes, esperas fijas, dependencia de red. Re-ejecutar hasta el verde no lo arregla: lo esconde.

## Prohibido

- Repetir el mismo comando esperando otro resultado sin haber cambiado nada con intención.
- Subir un timeout o agregar una espera fija como primer fix.
- `catch` vacío, `try` que traga, devolver un default falso para tapar el error.
- Borrar o aflojar una aserción, `skip`/`only`/`xit`, bajar umbrales de cobertura.
- `any`, casts o `@ts-ignore` para callar al compilador.
- Editar varias cosas a la vez "a ver si alguna lo arregla".
- Arreglar el dato a mano en la base y dar el bug por cerrado.
- Declarar arreglado porque "ya no pasa" sin saber por qué pasaba.

## Cuándo escalar

Si mataste tres hipótesis y no avanzás: cuestioná los supuestos (¿estoy corriendo el código que creo?
¿la rama, el build, el cache, el puerto correctos?), ampliá la observación (más logs, trace, ver
`backend-observability`) y, si sigue trabado, escalá con el paquete completo: repro mínimo,
hipótesis muertas con su experimento, y qué falta observar.

## Evidencia / DoD

Para afirmar "arreglado", el reporte incluye:

1. Repro mínimo (comando) y su salida **en rojo**, antes del fix.
2. Enunciado de causa "X produce Y bajo Z" y clase de la falla.
3. Hipótesis descartadas con el experimento que las mató.
4. Test de regresión: salida roja antes, verde después.
5. Salida del repro original y del grupo relacionado en verde, posterior al último edit.
6. Síntomas que la causa **no** explica (si los hay, no está cerrado).

## Checklist

- [ ] ¿Reproduje antes de tocar código y reduje el repro al mínimo?
- [ ] ¿Leí el error entero, hasta el primer frame propio y el primer error de la cascada?
- [ ] ¿Localicé el primer eslabón donde el valor ya está mal?
- [ ] ¿Mis hipótesis predicen algo observable y maté primero las baratas?
- [ ] ¿Escribí la causa como "X produce Y bajo Z" antes del fix?
- [ ] ¿La causa explica todos los síntomas, incluida la intermitencia?
- [ ] ¿El test de regresión falló antes del fix?
- [ ] ¿Clasifiqué la falla con evidencia?
- [ ] ¿No reintenté a ciegas, no silencié, no debilité ni salteé nada?
