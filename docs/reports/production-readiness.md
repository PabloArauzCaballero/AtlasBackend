# Preparación para producción — 2026-07-31

Checklist objetivo por área. Cada casilla marcada tiene detrás un comando ejecutado o un artefacto
verificable; las que no se pudieron comprobar en esta máquina se declaran como tales en la §8, no se
omiten.

---

## 1. Graphify

- [x] Se consultaron todos los artefactos relevantes (`graph.json`, `manifest.json`, `GRAPH_REPORT.md`, `cache/`, instantáneas por fecha).
- [x] Se documentaron módulos y relaciones: 32 aristas módulo → módulo derivadas de 8 987 nodos y 23 203 aristas.
- [x] Se revisaron ciclos y componentes huérfanos: **0 ciclos**, 6 nodos huérfanos (0,07 %, ninguno de dominio).
- [x] Los diagramas son coherentes con el grafo, y las dos diferencias conocidas están declaradas.

Evidencia: [graphify-audit.md](graphify-audit.md).

## 2. API

- [x] Todos los endpoints documentados — 252 rutas / 264 operaciones.
- [x] Todas con `operationId` — 264/264.
- [x] Todas con seguridad declarada — 264/264 (los 11 públicos declaran `security: []`).
- [x] Solicitudes y respuestas con esquema — **0** respuestas 2xx sin esquema (eran 252 de 263).
- [x] Errores relevantes documentados — 429 y 500 en todas; 400/401/403/404/409 según corresponde.
- [x] Ejemplos válidos — `no-invalid-schema-examples` y `no-invalid-media-type-examples` en verde.
- [x] Redocly pasa **sin errores** (eran 236).
- [x] Scalar montado en `/api/v1/reference`, con el contrato que genera el propio proceso.

## 3. Arquitectura

- [x] C4 completo: contexto, contenedores, componentes (API y worker) y despliegue.
- [x] Dependencias críticas explicadas, con fan-in y fan-out medidos.
- [x] Flujos principales documentados, incluido el recorrido crediticio de 22 etapas.
- [x] Integraciones documentadas: nueve proveedores con modo, coste y salud.
- [x] ADR completos — 7, incluidos los dos de esta intervención.

## 4. Datos

- [x] Entidades catalogadas — 138 tablas en 12 esquemas, con narrativa de negocio (139/139).
- [x] Relaciones y restricciones comprobadas — `yarn check:migrations` en verde.
- [x] Índices documentados — verificados en la equivalencia del split (385/385).
- [x] Migraciones y seeds explicados, incluidas las dos trampas de ids literales entre perfiles.
- [x] Retención y sensibilidad definidas — **con una salvedad**: los periodos esperan confirmación
      legal (ATLAS-DATA-001).

## 5. Seguridad

- [x] Threat model realizado y ampliado a la superficie nueva (worker, sonda, manifiestos).
- [x] Secretos y permisos documentados; el manifiesto de producción **aborta** si falta cualquiera.
- [x] Riesgos críticos resueltos — los cuatro `BLOCKER` de la matriz de brechas están cerrados.
- [x] Datos sensibles protegidos en ejemplos y logs; el gate rechaza secretos en el contrato.
- [x] La imagen no corre como root, no lleva devDependencies y monta el sistema de archivos en solo
      lectura en producción.

## 6. Operación

- [x] Health checks documentados y **verificados con el stack real corriendo**.
- [x] Logs, métricas y trazas definidos; stdout JSON redactado y correlacionado.
- [x] Alertas y SLO definidos — 19 reglas Prometheus.
- [x] Runbook de despliegue actualizado con la separación de roles.
- [ ] **Backup, restauración y rollback comprobados** — ver §8.

## 7. Calidad

- [x] MkDocs compila en modo estricto.
- [x] No existen enlaces internos rotos (lo garantiza `strict: true`).
- [x] No existen páginas huérfanas (navegación explícita).
- [x] No existen marcadores `TODO`/`FIXME`/`TBD` en la documentación final.
- [x] No existen contradicciones conocidas; las tres deudas aceptadas están declaradas con su motivo.
- [x] CI/CD documental activo: `check:openapi`, `docs:openapi:lint`, `docs:build --strict` y la
      validación de los manifiestos de compose.

---

## 8. Lo que NO se pudo verificar en esta máquina

Se declara explícitamente. El criterio del proyecto es no dar por cerrado un gate que no corrió.

| Elemento | Motivo | Dónde se cubre |
|---|---|---|
| Migración `up → down → up` sobre base limpia | Se verificó `up` completo desde cero en el stack containerizado; el ciclo con `down` es un job de CI | Job `db-and-cache-integration` |
| Smokes de API con credenciales reales | Exigen credenciales inyectadas que no deben versionarse | Job de integración de CI |
| `yarn check:db-privileges --strict` | Exige los roles `atlas_app_rw` / `atlas_migrator` creados | Job de integración de CI |
| **Backup y restauración** | Depende del proveedor de PostgreSQL gestionado, que no existe en local | Procedimiento del proveedor; pendiente de ensayo en staging |
| **Rollback de despliegue** | Requiere dos versiones publicadas en un registro | Ensayo en staging |

Los dos últimos son los únicos elementos del checklist que quedan **sin marcar**, y son los que
impiden una declaración incondicional. Ver [Validación final](final-validation.md).

---

## 9. Métricas de calidad

| Métrica | Objetivo | Medido |
|---|---:|---:|
| Endpoints documentados | 100 % | **100 %** (264/264) |
| Operaciones con `operationId` | 100 % | **100 %** |
| Operaciones con seguridad definida | 100 % | **100 %** |
| Respuestas 2xx con esquema | 100 % | **100 %** |
| Módulos críticos documentados | 100 % | **100 %** (27/27) |
| Entidades relevantes catalogadas | 100 % | **100 %** (139/139 con narrativa) |
| Eventos relevantes documentados | 100 % | **100 %** (89 en 9 familias) |
| Enlaces internos válidos | 100 % | **100 %** (`mkdocs build --strict`) |
| Reglas Redocly con error | 0 | **0** |
| Errores de compilación MkDocs | 0 | **0** |
| Marcadores TODO/TBD en documentación | 0 | **0** |
| Riesgos críticos abiertos | 0 | **0** |
| Runbooks críticos disponibles | 100 % | Despliegue sí; backup/restore pendiente de ensayo |
| Pruebas en verde | 100 % | **2 469 / 2 469** |
| Operaciones con `description` larga | — | 118/264 (deuda declarada ATLAS-DOC-006) |
