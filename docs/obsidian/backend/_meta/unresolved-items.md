---
title: "Elementos sin resolver"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - meta
aliases: []
related: []
---

# Elementos sin resolver

Segunda pasada sobre las preguntas abiertas de la primera generación. **Seis se cerraron leyendo el código**, una con una decisión del propietario (`U-007`) y otra queda con la política ya escrita pero pendiente de aprobar e implementar (`U-008`).

Solo dos siguen realmente abiertas: si producción usa KMS (`U-006`) y si las familias de eventos sin persistencia son roadmap (`U-009`).

## Resueltas

### ✅ U-001 — ¿Se purgan los eventos procesados del outbox?

**Respuesta: no.** Una búsqueda de `DELETE FROM`, `destroy`, `purge` y `prune` sobre `outbox_events` en todo `src/` no devuelve nada. Existen `purge_idempotency_keys` y `apply_retention_policies`, pero ninguno toca el outbox.

Pasa de `NO_CONFIRMADO` a **riesgo verificado**: [[14-audits/risks-register|DATA-003]]. Queda un residuo menor: si alguna fila de `retention_policies` lo cubre por configuración, solo se ve en un entorno.

### ✅ U-002 — ¿Se propaga el `correlationId` a los jobs?

**Respuesta: sí.** `outbox_events` tiene columna dedicada `correlation_id` (`outbox-events.model.ts:71-72`) y `ApiCommandOutboxInterceptor` la rellena desde `request.correlationId` (`outbox.interceptor.ts:52`). El módulo `events` además permite filtrar por ese campo.

La trazabilidad request → evento → procesamiento en el worker está intacta. Documentado en [[09-observability/correlation-ids]].

### ✅ U-003 — ¿Qué orden garantiza el reclamo de lote?

**Respuesta: el reclamo es determinista; la entrega no.**

```sql
ORDER BY priority DESC NULLS LAST, available_at ASC NULLS FIRST, _id ASC
LIMIT :limit FOR UPDATE SKIP LOCKED
```

`SKIP LOCKED` permite que varios workers tomen lotes distintos en paralelo, así que dos eventos del mismo agregado pueden procesarse a la vez. Documentado en [[07-async-processing/events]].

Hallazgo colateral: el modelo de reintentos es más completo de lo documentado inicialmente — `attempts`, `max_attempts` (3 por defecto), `available_at` como backoff, y `failed` como **dead-letter explícita**. Corregido en [[07-async-processing/retry-and-dead-letter]].

### ✅ U-004 — ¿Se valida el destino de las llamadas salientes (SSRF)?

**Respuesta: sí, y a fondo.** El único punto donde una URL del cliente dirige una petición saliente es `baseUrl` de las pruebas de sistema. `systems-test-url-policy.util.ts` aplica allowlist de host por entorno, bloqueo de metadata cloud, rangos privados IPv4/IPv6, **verificación de las direcciones DNS resueltas** (anti-rebinding) y exigencia de ruta relativa. Los defaults de staging y producción vienen **vacíos**: fail-closed.

`T-19` pasa de ❓ a ✅ en [[08-security/threat-model]].

### ✅ U-005 — ¿Está aislada la sonda del worker?

**Respuesta: sí para el worker; no para la API.**

`docker-compose.prod.yml` declara el worker con `expose: '3006'` y **sin `ports`** — no sale de la red interna, con la razón escrita en el propio fichero. La API publica `3005`, y `/metrics` **comparte ese puerto**, así que es alcanzable dondequiera que lo sea la API.

Precisado en [[14-audits/risks-register|SEC-004]]: la única mitigación posible es bloquear la ruta en el proxy inverso.

### ✅ U-010 — ¿Puede un despliegue quedar sin trabajo de fondo por error?

**Respuesta: no, falla al arrancar.** `env-cross-checks.ts:89-111` rechaza las dos combinaciones peligrosas: `APP_ROLE=worker` con el planificador apagado (arrancaría sano sin ejecutar nada) y `APP_ROLE=api` con el planificador encendido (haría creer que los jobs corren). El comentario lo justifica: *"no funcionan a medias: fallan en silencio, que es peor"*.

Además, `RUNTIME_JOBS_ALLOW_WITHOUT_LOCK: 'false'` en producción hace fail-closed sin Redis.

---

## Abiertas — requieren entorno o decisión humana

### ❓ U-006 — ¿Producción usa KMS?

- **Estado:** `PENDIENTE` — no verificable desde el código
- **Riesgo:** sin `KMS_KEY_ID` + `AWS_REGION`, la clave maestra de PII se deriva de una variable de entorno. Ver [[14-audits/risks-register|SEC-002]].
- **Cómo cerrarlo:** comprobar ambas variables en el entorno real. El arranque emite un `console.warn` ruidoso si faltan — buscarlo en los logs de producción es la vía más rápida.

### ✅ U-007 — ¿Quién es propietario de cada módulo?

**Resuelto.** `@PabloArauzCaballero` es el propietario. Las 330 notas llevan ese `owner` en el frontmatter y `.github/CODEOWNERS` lo asigna por ruta.

> [!warning] Corrección — el CODEOWNERS ya existía
> La primera pasada afirmó que **no había** `CODEOWNERS`. Era **falso**: existe desde antes, pero asignaba las rutas a equipos de organización (`@atlas-backend-team`, `@atlas-security-team`, …).
>
> Eso tenía una consecuencia que el error tapaba: los equipos solo resuelven dentro de una **organización** de GitHub, y este es un repositorio personal. GitHub **ignora en silencio** a los propietarios que no puede resolver, así que *Require review from Code Owners* no habría solicitado revisión a nadie. Un control que parecía configurado y no lo estaba.
>
> Ahora las rutas apuntan a `@PabloArauzCaballero`, que sí resuelve. La partición por áreas se conserva como comentario, lista para volver a equipos el día que exista una organización.

**Residuo:** la protección de rama que hace obligatoria la revisión se activa **en GitHub** (Settings → Branches), no en el repositorio. El propio `CODEOWNERS` lo documenta. No es verificable desde aquí.

### ⚠️ U-008 — ¿Cuál es la política de copias de seguridad?

**Propuesta escrita; falta aprobarla e implementarla.**

[[05-data/backups-and-restore]] y [[10-operations/disaster-recovery]] contienen ahora una política recomendada con valores concretos: PITR con RPO 5 min / RTO 1 h para PostgreSQL, retención de 30 días de WAL y 12 meses de snapshots mensuales, copias cifradas e inmutables fuera de la cuenta de producción, y simulacro mensual de restauración que incluye **una prueba de descifrado de PII**.

**Sigue abierto** porque una política no aprobada ni implementada no protege de nada:

- [ ] Aprobar o ajustar los RPO/RTO
- [ ] Implementarlo en la infraestructura
- [ ] Ejecutar el primer simulacro y registrar el RTO real

> [!danger] El punto que no admite recuperación
> Todo escenario de desastre se recupera con tiempo **salvo uno**: la destrucción de la clave maestra de cifrado. Los datos seguirían ahí y nadie podría leerlos. Configurar una alerta sobre el borrado programado de la CMK es la mitigación más barata del sistema.

### ❓ U-009 — ¿Están vivas las familias de eventos de compras y cuotas?

- **Estado:** `PENDIENTE` — decisión de producto, no técnica
- **Evidencia:** 40 de 92 eventos sin dominio persistido. Ver [[14-audits/contradictions|C-001]].
- **Cómo cerrarlo:** confirmar si es roadmap y marcarlo como tal en el propio registro, o retirarlos.

## Relaciones

- [[01-overview/assumptions-and-gaps]] · [[14-audits/contradictions]] · [[14-audits/risks-register]] · [[_meta/generation-log]]
