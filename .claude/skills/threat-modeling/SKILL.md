---
name: threat-modeling
description: Modelado de amenazas con STRIDE aplicado a un flujo o feature ANTES de construirlo — diagrama de flujo de datos, límites de confianza, una amenaza por categoría (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege), control mitigante, riesgo residual y priorización. Produce un artefacto reutilizable por feature de salud (archivo clínico, agenda, recetas, seguros). Usar al diseñar una feature nueva o sensible, al revisar un diseño antes de codear, y como insumo de la evaluación de seguridad.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Modelado de amenazas (STRIDE)

El control de seguridad más barato es el que se diseña antes de escribir código (OWASP A06:2025
Insecure Design). Modelar amenazas es responder cuatro preguntas: **¿qué estamos construyendo?
¿qué puede salir mal? ¿qué hacemos al respecto? ¿lo hicimos bien?** STRIDE estructura la segunda.

Complementa a `security-guardrails` (catálogo de controles) y alimenta a `pentest-methodology`
(dónde mirar en el ejercicio). Hacelo al inicio de una feature sensible, no después.

## 1. ¿Qué estamos construyendo? — diagrama de flujo de datos

Dibujá el flujo con estos elementos: **actores externos** (paciente, doctor, aseguradora),
**procesos** (API, worker, servicio), **almacenes** (base, cache, archivos) y **flujos de datos**
entre ellos. Marcá los **límites de confianza**: dónde el dato cruza de algo menos confiable a
algo más (navegador → API, API → base, API → tercero). Las amenazas viven en esos cruces.

## 2. ¿Qué puede salir mal? — STRIDE por elemento

Una fila por elemento/flujo que cruza un límite de confianza:

| Categoría | Pregunta | Propiedad que rompe |
|---|---|---|
| **S**poofing | ¿Alguien puede hacerse pasar por otro actor? | Autenticidad |
| **T**ampering | ¿Se puede alterar el dato en tránsito o en reposo? | Integridad |
| **R**epudiation | ¿Alguien puede negar que hizo una acción? | No repudio |
| **I**nformation disclosure | ¿Se filtra información a quien no debe? | Confidencialidad |
| **D**enial of service | ¿Se puede tumbar o degradar el servicio? | Disponibilidad |
| **E**levation of privilege | ¿Un actor gana permisos que no le tocan? | Autorización |

## 3. ¿Qué hacemos? — control por amenaza

Por cada amenaza plausible, un control y a qué skill pertenece:

| STRIDE | Control típico | Skill |
|---|---|---|
| Spoofing | Autenticación fuerte, MFA, tokens firmados | `authn-identity` |
| Tampering | TLS, validación en el borde, firmas, integridad en base | `security-guardrails`, `integrity-testing` |
| Repudiation | Auditoría append-only de acciones sensibles | `audit-trail-history` |
| Info disclosure | Autorización por objeto, respuesta mínima, cifrado, datos sensibles fuera de logs | `authz-access-control`, `data-privacy-sensitive` |
| DoS | Rate limit, límites de payload/paginación, timeouts | `security-guardrails`, `caching-strategy` |
| Elevation | Deny-by-default, RBAC + ownership, chequeo de función | `authz-access-control` |

## 4. ¿Lo hicimos bien? — riesgo residual y priorización

- Para cada amenaza: **mitigada / aceptada / transferida / pendiente**. La aceptación de un
  riesgo lleva dueño y fecha de revisión (`pentest-reporting-remediation`).
- Priorizá por impacto × probabilidad. En salud, cualquier amenaza de **Information disclosure**
  o **Elevation** sobre datos de pacientes es prioridad máxima por defecto.
- Las amenazas no mitigadas se convierten en casos de prueba para el ejercicio de evaluación y en
  tests de `security-testing`.

## 5. Foco por feature de salud (ejemplos de dónde mira STRIDE)

- **Archivo clínico**: Info disclosure (otro doctor sin relación de atención), Elevation, Tampering
  (edición destructiva → `audit-trail-history`), Repudiation (quién vio/editó).
- **Agenda/citas**: Tampering y DoS (doble reserva, `concurrency-and-locking`), Info disclosure.
- **Documentos con valor legal** (contrato, factura, comprobante): Tampering (monto), Repudiation
  (quién emitió), Info disclosure (`audit-trail-history`).
- **Superficies públicas** (landing, enlaces compartidos): Info disclosure antes del consentimiento
  (`data-privacy-sensitive`).

## Anti-patrones
- Modelar amenazas después de construir, como trámite.
- Enumerar amenazas y no asignar control ni dueño (lista muerta).
- Saltar el diagrama y los límites de confianza (sin ellos STRIDE es genérico).
- Tratar toda amenaza por igual en un dominio donde disclosure de datos sensibles es lo más grave.

## Checklist
- [ ] Diagrama de flujo de datos con actores, procesos, almacenes y límites de confianza.
- [ ] STRIDE aplicado a cada elemento/flujo que cruza un límite.
- [ ] Un control por amenaza plausible, enlazado a su skill.
- [ ] Riesgo residual clasificado (mitigado/aceptado/pendiente) con dueño.
- [ ] Amenazas no mitigadas convertidas en casos de prueba/tests.

## Evidencia / DoD
Entregá el diagrama, la tabla STRIDE con control y estado por amenaza, y la lista de riesgos
aceptados con dueño y fecha. Las amenazas pendientes quedan como tickets o tests. Declará **No
cubierto**: qué flujos del feature no se modelaron. Ver `evidence-and-verification`.
