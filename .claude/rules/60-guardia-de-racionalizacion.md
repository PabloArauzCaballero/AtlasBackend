<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 60 — Guardia de racionalización

Prohíbe avanzar cuando el propio razonamiento produce una excusa para saltear una fase, una
verificación, el plan o el reporte. Aplica en todo momento, y **sobre todo cuando hay apuro**:
la prisa es la condición en la que estas racionalizaciones aparecen.

Cuando reconozcas uno de estos pensamientos, aplicá la respuesta obligatoria **antes** de seguir.

## Sobre el plan y el reporte

| Racionalización | Respuesta obligatoria |
|---|---|
| "El plan es exagerado para algo tan chico." | El tamaño no exime. Un trabajo chico es un hito con una microtarea, y se escribe igual: cuesta treinta segundos y es lo que lo hace auditable (regla 20). |
| "Total es un cambio de una línea." | Una línea puede romper producción. La línea tiene su microtarea, su criterio de aceptación y su DoD, como cualquier otra. |
| "El reporte lo escribo después." | "Después" es "nunca". El `REPORTE.md` se escribe al cerrar la sesión, terminada o no (regla 40). Si te quedás sin tiempo, el reporte es lo último que se saca, no lo primero. |
| "Esto lo marco hecho y lo termino mañana." | `HECHO` exige DoD ejecutado con salida pegada. Si falta, el estado es `A MEDIAS` con qué anda, qué no anda y qué falta exactamente. Marcarlo hecho es falsear el estado. |
| "El usuario tiene apuro, salteo el proceso." | El apuro cambia la profundidad del trabajo, nunca la honestidad del estado. Entregá menos alcance bien declarado, no el mismo alcance mal verificado. |
| "Lo del plan ya lo tengo en la cabeza." | Lo que está solo en la cabeza no sobrevive a un corte de sesión ni lo puede retomar otra persona. Va al archivo. |
| "Actualizo el plan al final, ahora avanzo." | El `PLAN.md` es el estado. Desactualizado, miente. Se actualiza al abrir y al cerrar cada microtarea (regla 50). |

## Sobre la verificación

| Racionalización | Respuesta obligatoria |
|---|---|
| "Es obvio que funciona." | La obviedad no es un veredicto. Ejecutá el DoD y pegá la salida, o declaralo `A MEDIAS`. |
| "Ya lo probé antes." | Si cambiaste código después, esa evidencia venció: el área vuelve a `WRITTEN` y se re-verifica (regla 30). Si no cambiaste nada, citá la corrida con su salida. |
| "Es un cambio pequeño." | El tamaño no elimina la obligación de verificar el comportamiento observable. |
| "Ya compiló, está listo." | Compilar prueba que el tipo cierra, no que el comportamiento sea el pedido. |
| "El linter pasa, está listo." | Lint es evidencia de calidad estática, nunca de comportamiento. |
| "La API devuelve 200." | 200 no prueba semántica, ni persistencia, ni UI. |
| "No veo errores." | No haber buscado no es evidencia de ausencia. Revisá consola, red y logs, y decilo. |
| "No hace falta volver a correr." | Si el fix cambia la causa del fallo, se re-ejecuta la prueba que lo detectó. |
| "Ya hice suficiente." | El criterio es el Definition of Done, no la sensación de esfuerzo. |
| "La UI ya se ve bien." | Para cambios visuales: capturas por viewport y tema, inspeccionadas de verdad (regla 10, fase 6). |
| "Backend después." | No declares full-stack si falta persistencia o contrato real. |
| "Podemos mockear para cerrar." | El mock cubre una capa; no prueba la integración. |

## Sobre los tests y los fallos

| Racionalización | Respuesta obligatoria |
|---|---|
| "El test falla por timing." | Demostralo con trace o log antes de tocar una espera. |
| "Subamos el timeout." | Primero determiná por qué no llegó la condición esperada. |
| "El entorno está raro." | `ENVIRONMENT` solo se declara después de reproducir y acotar, con evidencia. |
| "El test es demasiado estricto." | Contrastalo contra el requisito antes de modificarlo. Si el requisito manda, el test tiene razón. |
| "Lo salteo y lo veo después." | `skip` para cerrar está prohibido (regla 00). Se corrige o se declara `BLOQUEADO` con evidencia. |
| "Con un reintento pasa." | Un reintento que tapa un fallo intermitente esconde un bug real, normalmente de concurrencia. |

## Sobre el descubrimiento y el alcance

| Racionalización | Respuesta obligatoria |
|---|---|
| "Seguramente ya existe." | Localizalo por código. No conviertas probabilidad en hecho. |
| "Creo el endpoint y después lo conecto." | Primero confirmá si ya existe contrato o ruta equivalente. |
| "Voy a aprovechar para refactorizar." | Fuera de alcance. Anotalo; no lo arregles (regla 00). |
| "Esta abstracción va a servir después." | No se crea abstracción especulativa sin un segundo uso real o un patrón existente. |
| "Esa frase del requisito seguro significa esto." | Registrala como ambigüedad con el supuesto tomado y a quién confirmárselo. |
| "Voy a leer todo para tener contexto." | Leé solo lo que puede cambiar la próxima decisión. |
| "Esto lo hago de paso, es mínimo." | Todo trabajo no previsto entra al plan como microtarea con CA y DoD, o no se hace. |

## Sobre calidad, seguridad y recursos

| Racionalización | Respuesta obligatoria |
|---|---|
| "La seguridad no es parte de este ticket." | La autorización correcta no es gold-plating: es condición de corrección. |
| "El usuario no pidió accesibilidad." | En los componentes que tocás se mantiene la calidad base del producto. |
| "Esos datos de prueba sirven igual." | Datos inventados presentados como reales están prohibidos; los sintéticos se declaran (regla 00). |
| "Total el log lo ve solo el equipo." | Los datos personales, financieros y biométricos no van a logs, trazas, capturas ni reportes. Nunca. |
| "Abro varios agentes para ir más rápido." | La estabilidad de la máquina manda sobre la velocidad: respetá los límites de concurrencia. |

## Frases-gatillo

Si tu propio texto contiene alguna de estas, **frená y verificá** antes de seguir:

> debería · seguramente · casi · en principio · asumo que · por lo general · creo que ya ·
> es obvio · mínimo · rapidito · después lo veo · lo dejo listo para

Ninguna de estas palabras puede aparecer en una afirmación de estado del `REPORTE.md`.

## Regla de aplicación

Cuando una racionalización encaja: nombrala, aplicá la respuesta obligatoria, y recién entonces
seguí. Si la respuesta obligatoria exige una acción (ejecutar el DoD, buscar el equivalente,
reproducir el fallo), esa acción se hace **ahora**, no se agenda.

Skill que desarrolla el oficio: `rationalization-guard`.
