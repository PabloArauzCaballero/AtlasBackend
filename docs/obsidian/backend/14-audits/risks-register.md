---
title: "Registro de riesgos"
type: "audit"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - audit
  - risks
aliases: []
related: []
---

# Registro de riesgos

Hallazgos de **análisis estático** en la revisión `80fc741`. Ninguno procede de medición en un entorno vivo.

> [!info] Hechos y recomendaciones van separados
> Cada entrada distingue lo **observado** (verificable en el código) de lo **recomendado** (juicio, discutible). Un hallazgo sin evidencia citable no entra en esta tabla.

## Resumen

| ID | Área | Hallazgo | Severidad | Estado |
|---|---|---|---|---|
| [[#SEC-002]] | Seguridad | PII cifrada con clave derivada de variable de entorno si falta KMS | **Alta** | Abierto |
| [[#PERF-001]] | Rendimiento | 168 de 244 columnas FK sin índice en el lado hijo | Media | Abierto |
| [[#SEC-001]] | Seguridad | `TenantGuard` no exige tenant; solo detecta contradicción | Media | Abierto |
| [[#SEC-004]] | Seguridad | `/metrics` sin autenticación de aplicación | Media | Mitigación externa |
| [[#ARCH-001]] | Arquitectura | 153 FK cruzan esquemas de dominio | Media | Aceptado por diseño |
| [[#ARCH-002]] | Arquitectura | `platform_ops` agrupa 4 subdominios en 25 tablas | Baja | Abierto |
| [[#DATA-002]] | Datos | Relaciones polimórficas sin integridad referencial | Baja | Abierto |
| [[#OPS-001]] | Operación | Los jobs se agendan solo por intervalo, sin ventana horaria | Baja | Abierto |
| [[#DATA-001]] | Datos | Ninguna FK usa `ON DELETE CASCADE` | Informativo | Por diseño |
| [[#DOC-001]] | Documentación | 40 de 92 eventos describen dominios sin persistencia | Media | Ver [[14-audits/contradictions]] |

---

## SEC-002 — PII sin KMS en producción

**Severidad:** Alta · **Probabilidad:** Media · **Estado:** Abierto

**Observado.** `src/config/env.ts:44-50`: si `NODE_ENV === 'production'` y falta `KMS_KEY_ID` o `AWS_REGION`, se emite un `console.warn` y **el arranque continúa**. En ese modo la clave maestra de cifrado de PII se deriva por SHA-256 de una variable de entorno.

**Impacto.** Comprometer esa variable descifra toda la PII almacenada: teléfonos, correos, documentos de identidad. En un backend KYC es el activo de mayor valor.

**Atenuantes existentes.** El `providerId` va embebido en cada valor cifrado, así que valores `local` y KMS conviven sin romper el descifrado. `yarn crypto:reencrypt-pii` migra los existentes. El propio comentario del código reconoce el riesgo y remite al hallazgo S-M3 de la auditoría interna.

**Recomendación.** Convertir el aviso en fallo de arranque en producción, o exigirlo por gate de despliegue. Es la única entrada de este registro donde el código ya sabe que hay un problema y decide no bloquear.

---

## PERF-001 — FK sin índice en el lado hijo

**Severidad:** Media · **Probabilidad:** Alta a volumen · **Estado:** Abierto

**Observado.** 168 de 244 columnas con FK no aparecen como primer campo de ningún índice —de hecho, no aparecen en **ninguno**—. Método: se cruzaron las 244 `ForeignKeySpec` de las migraciones con los 290 índices declarados, aplicando la regla de prefijo de PostgreSQL.

Ejemplos: `customer_status_events.customer_id`, `data_provider_requests.provider_id`, `identity_verification_attempts.customer_id`, `customer_identity_documents.front_evidence_id`.

La estrategia actual indexa `_tenant_id` en casi toda tabla y añade algunas combinaciones después, pero no las columnas FK de negocio.

**Impacto.** PostgreSQL no indexa automáticamente el lado hijo de una FK. Afecta a (a) los `JOIN` por esa columna y (b) la verificación de `RESTRICT` al borrar un padre, que hace *scan* del hijo.

> [!warning] Riesgo estático, no cuello confirmado
> **No se ejecutó ninguna medición.** Sin volumetría ni plan de ejecución, no se puede afirmar que ninguna consulta sea lenta hoy. `yarn db:capture-query-baseline` y `yarn db:extract-read-workload` existen para producir esa evidencia.

**Recomendación.** Capturar el baseline primero; indexar después solo lo que la carga real justifique. Añadir 168 índices a ciegas encarece toda escritura.

---

## SEC-001 — `TenantGuard` permisivo

**Severidad:** Media · **Estado:** Abierto

**Observado.** `src/common/guards/tenant.guard.ts` devuelve `true` si el token no trae `tenantId`, y también si el header `x-tenant-id` está ausente o vacío. Solo lanza `403` cuando el header existe **y difiere** del token.

**Impacto.** El guard no garantiza aislamiento: lo garantiza que cada servicio filtre por `_tenant_id`. La existencia del gate `yarn check:tenant-header` con línea base (`.tenant-header-baseline.json`) confirma que la cobertura no era completa cuando se creó.

**Recomendación.** En rutas por tenant, exigir el header y rechazar tokens sin `tenantId` en vez de dejar pasar.

---

## SEC-004 — `/metrics` sin autenticación de aplicación

**Severidad:** Media, condicionada a la exposición de red · **Estado:** Mitigación externa

**Observado.** `/metrics` se excluye del prefijo global (`main.ts:72`) y no pasa por `JwtAuthGuard`. Expone nombres de ruta, códigos de estado y latencias.

**Impacto.** Facilita perfilar el sistema. La regla del proyecto ya exige red aislada y `@SkipThrottle` para endpoints de infraestructura, pero **esa condición no es verificable desde el código**.

**Recomendación.** Confirmar el aislamiento de red en el despliegue real y dejarlo documentado en [[10-operations/deployment]].

---

## ARCH-001 — Acoplamiento físico entre dominios

**Severidad:** Media · **Estado:** Aceptado por diseño

**Observado.** 153 de 244 FK cruzan el límite de un esquema de dominio. Los 12 esquemas son un límite **lógico**: comparten base, transacciones e integridad referencial.

**Impacto.** Extraer un dominio a su propio servicio exigiría sustituir esas FK por validación en aplicación y aceptar consistencia eventual. No es un defecto de un monolito modular —es su contrapartida—, pero conviene tenerlo explícito antes de prometer una extracción.

**Contraste.** El grafo de **módulos** sí está limpio: acíclico y sin un solo `forwardRef`. El acoplamiento vive en los datos, no en el código.

---

## ARCH-002 — `platform_ops` como cajón de sastre

**Severidad:** Baja · **Estado:** Abierto

**Observado.** 25 tablas —el esquema mayor— mezclando cuatro responsabilidades sin ciclo de vida común: infraestructura de ejecución (`idempotency_keys`, `outbox_events`, `system_job_runs`), catálogos autodescriptivos (`system_*_catalog`), motor de flujos (`workflow_*`) y versionado de esquema (`schema_*`).

**Recomendación.** Evaluar la separación en esquemas propios. Coste bajo (los `search_path` ya están centralizados), beneficio en claridad de propiedad.

---

## DATA-002 — Relaciones polimórficas sin integridad referencial

**Severidad:** Baja · **Estado:** Abierto

**Observado.** Existen punteros del tipo `target_type` + `target_id` (por ejemplo en `system_catalog_review_events`) que no pueden tener FK porque el destino varía. El catálogo de relaciones solo recoge las 244 FK declaradas: estas quedan fuera.

**Impacto.** Nada impide un `target_id` huérfano. No se puede detectar sin consultar datos.

**Recomendación.** Documentar los pares polimórficos y añadir validación en aplicación, o una comprobación periódica de integridad.

---

## OPS-001 — Jobs sin ventana horaria

**Severidad:** Baja · **Estado:** Abierto

**Observado.** Los 9 jobs se agendan por `intervalMs`, no por expresión cron. `apply_retention_policies` y `recalculate_data_quality` —los más pesados— pueden ejecutarse en hora punta.

**Recomendación.** Revisar los intervalos configurados en producción, o introducir ventana horaria para los jobs de mantenimiento.

---

## DATA-001 — Sin `ON DELETE CASCADE`

**Severidad:** Informativo · **Estado:** Por diseño

**Observado.** `addForeignKeys` aplica `onDelete: allowNull ? 'SET NULL' : 'RESTRICT'` a las 244 FK. Ninguna cascada.

**Lectura.** Es deliberado y coherente con un sistema auditado: perder evidencia por un `DELETE` accidental es peor que acumular filas. La contrapartida es que **el borrado real de un cliente exige un procedimiento explícito** — no basta con `DELETE FROM customers`. Ver [[05-data/retention-and-deletion]] y las solicitudes de titular en `data_subject_requests`.

---

## Relaciones

- [[14-audits/contradictions]] · [[14-audits/technical-debt]] · [[08-security/security-overview]] · [[01-overview/assumptions-and-gaps]]
