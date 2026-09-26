---
name: secure-code-review
description: Revisión de código con lente de seguridad sobre el código propio — dónde mirar (bordes de entrada, autorización, queries, secretos, deserialización, logging de datos sensibles, SSRF), patrones peligrosos a buscar con grep, cómo confirmar de forma segura si un hallazgo es explotable, y cómo asignarle severidad y prioridad de corrección. Usar al revisar un PR que toca autenticación, autorización, datos sensibles o entrada de usuario, al auditar un módulo antes de un release, y como parte de caja blanca de una evaluación de seguridad. Diseñar el modelo de permisos en sí es `authz-access-control`.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Revisión de código con lente de seguridad

Es la vista de caja blanca: encontrar el bug en el código, no probándolo desde afuera. Complementa
`code-review-standard` (revisión general) y `security-guardrails` (los controles que buscás). Es
más barata que un pentest y encuentra clases enteras de golpe con `grep`.

## 1. Dónde mirar primero (por rendimiento del esfuerzo)
1. **Bordes de entrada**: controllers, handlers, params de ruta/query/body — ¿hay DTO con
   validación y allowlist? (`security-guardrails`, mass assignment).
2. **Autorización**: cada acceso por id, ¿valida ownership/tenant/rol en el backend?
   (`authz-access-control`, `multi-tenancy`). Es la clase más grave en salud.
3. **Queries**: ¿parametrizadas / vía ORM? Nada de concatenar input en SQL crudo.
4. **Secretos**: claves/tokens hardcodeados, en config commiteada, en logs.
5. **Salida y logs**: ¿se loguea datos sensibles, tokens, payload crudo? (`data-privacy-sensitive`).
6. **Integraciones**: llamadas a URLs provistas por el usuario (SSRF), respuestas de terceros
   confiadas sin validar.

## 2. Patrones peligrosos para buscar con grep

Usá estos como punto de partida (adaptá a los nombres reales del proyecto):

```bash
# SQL crudo con interpolación de variables
grep -rnE "(query|execute)\(.*\$\{" src/
# Sanitizado de Angular desactivado
grep -rn "bypassSecurityTrust" src/
# any/as/! que callan al compilador en bordes (typescript-standards)
grep -rnE ":\s*any\b|as any| as unknown as " src/
# posible mass assignment: body crudo a la entidad
grep -rnE "\.(create|assign|update)\(.*req\.body|entity, req\.body" src/
# secretos hardcodeados
grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"]" src/
# logging de objetos potencialmente con datos sensibles
grep -rnE "console\.(log|error)\(|logger\.(log|debug)\(.*(user|patient|body)" src/
# fetch/axios a URL variable (SSRF)
grep -rnE "(fetch|axios|got|request)\(\s*[a-zA-Z_].*(url|href|link)" src/
```

Un match **no es un bug**; es un lugar para leer con atención. Confirmá el contexto antes de
reportar (`anti-hallucination-guard`).

## 3. Confirmar explotabilidad de forma segura
- Leé el camino completo: ¿el input llega al sink sin pasar por validación/autorización?
- Si podés, confirmalo con la prueba dinámica mínima en staging (`web-app-pentest`/`api-pentest`),
  no con un ataque real ni contra producción.
- Distinguí **bug latente** (control ausente pero no alcanzable hoy) de **explotable** (hay un
  camino desde un actor no confiable). Ambos se reportan; la severidad difiere.

## 4. Severidad y prioridad
- Puntuá con **CVSS v4.0** (`pentest-reporting-remediation`) y ajustá por contexto: exposición de
  datos sensibles o cruce de tenant sube la prioridad por el dominio, aunque el CVSS base sea medio.
- Un control ausente en un patrón que se repite (p. ej. falta de chequeo de ownership en varios
  endpoints) es **un hallazgo sistémico**: reportá el patrón y la lista, no diez tickets sueltos.

## 5. Qué mira esta revisión que la dinámica no ve
- Criptografía casera o mal usada (algoritmo, IV reusado, comparación no constante).
- Deserialización de datos no confiables.
- Condiciones de carrera en el código (lee-modifica-escribe sin lock, `concurrency-and-locking`).
- Autorización que "parece" estar pero depende de un flag del cliente.
- Secretos en el historial de git (aunque ya no estén en HEAD).

## Anti-patrones
- Reportar cada match de grep como vulnerabilidad sin leer el contexto.
- Aprobar un PR de auth "porque los tests pasan" sin leer la lógica de autorización.
- Confundir ausencia de un control con explotabilidad inmediata (o viceversa).
- Pedir un fix sin señalar el patrón sistémico cuando el bug se repite.

## Checklist
- [ ] Bordes de entrada con DTO validado y allowlist.
- [ ] Autorización por objeto/tenant/rol revisada en cada acceso por id.
- [ ] Queries parametrizadas; sin SQL crudo con input.
- [ ] Sin secretos hardcodeados ni en logs; sin datos sensibles en logs.
- [ ] URLs de usuario validadas (SSRF); respuestas de terceros validadas.
- [ ] Criptografía estándar; sin carreras lee-modifica-escribe sin lock.
- [ ] Hallazgos sistémicos reportados como patrón + lista.

## Evidencia / DoD
Por hallazgo: archivo:línea, la clase (CWE/OWASP), por qué es alcanzable o por qué es latente,
severidad CVSS v4.0 y el fix concreto. Pegá el comando grep y el fragmento (sin secretos reales).
A `pentest-reporting-remediation`. Declará **No cubierto**: módulos o rutas no revisadas. Ver
`evidence-and-verification`.
