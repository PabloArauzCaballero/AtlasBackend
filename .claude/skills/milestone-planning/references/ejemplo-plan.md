<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Ejemplo completo de PLAN.md

Plan real de un trabajo full-stack chico sobre la plataforma de salud.
Abrilo cuando necesites ver la forma completa del artefacto, no solo las reglas.

```markdown
# Plan — Impedir doble reserva de turno

- Fecha: 2026-09-19 · Repos: api, web · Predecesor: ninguno
- Resultado observable: dos pacientes no pueden quedarse con el mismo horario del mismo
  profesional; el segundo ve un mensaje de conflicto y no pierde lo que cargó.
- Kill-test: dos POST simultáneos al mismo horario → si ambos devuelven 201, no está hecho.

## Alcance
- IN: reserva de turno desde el portal del paciente.
- OUT: bloqueos de agenda del profesional, reprogramación, recordatorios.
- Ambigüedades: ¿los turnos contiguos (10:30 exacto tras uno que termina 10:30) se consideran
  solapados? Supuesto: NO se solapan. Confirmar con el responsable de producto.

## H1 — Un turno solapado se rechaza y el paciente ve por qué
**CA:** Dado un turno de 10:00–10:30 del profesional P, cuando otro paciente intenta reservar
10:15 con P, entonces no se crea el turno y la UI muestra el conflicto conservando el formulario.
**DoD:** E2E `reserva-conflicto` PASS con trace · sin datos de paciente en el log del rechazo.
**Estado:** TODO

### H1.S1 — Garantizar la invariante en la base
**CA:** Ningún par de turnos del mismo profesional queda solapado, aun con escrituras concurrentes.
**DoD:** inserción inválida rechazada por la base + prueba de concurrencia en verde.
**Estado:** TODO

| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Exclusion constraint por rango sobre (profesional, franja) | Insertar un turno solapado falla a nivel base | Inserción manual solapada → error de constraint (pegar salida) | TODO |
| H1.S1.M2 | Prueba de dos reservas concurrentes al mismo horario | Exactamente una de las dos sobrevive | Test de concurrencia dirigido en verde | TODO |

### H1.S2 — Traducir el rechazo a un contrato entendible
**CA:** El cliente recibe 409 con un código estable y sin detalles internos.
**DoD:** test de API del caso de conflicto + revisión contra `error-handling-contract`.
**Estado:** TODO

| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H1.S2.M1 | Mapear la violación del constraint a 409 `APPOINTMENT_OVERLAP` | La respuesta es 409 con ese código | Test de API del conflicto en verde | TODO |
| H1.S2.M2 | Verificar que el 409 no filtra datos del otro paciente | El cuerpo y el log no contienen datos de terceros | Inspección del log del caso (pegar salida enmascarada) | TODO |

### H1.S3 — Mostrar el conflicto sin perder el formulario
| ID | Microtarea | CA (binario) | DoD (comando) | Estado |
|---|---|---|---|---|
| H1.S3.M1 | Mapear `APPOINTMENT_OVERLAP` a mensaje de conflicto en el interceptor | El mensaje específico aparece, no el genérico | E2E `reserva-conflicto` PASS + captura | TODO |
| H1.S3.M2 | Conservar los datos cargados tras el rechazo | Los campos siguen completos después del 409 | E2E verifica campos tras el error | TODO |

## Riesgos y bloqueos previstos
| Riesgo | Impacto | Mitigación |
| La extensión de índices por rango no está habilitada en el entorno | Bloquea S1 | Verificarlo en la microtarea M1 antes de avanzar |
```
