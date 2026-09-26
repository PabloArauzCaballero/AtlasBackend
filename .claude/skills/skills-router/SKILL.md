---
name: skills-router
description: Índice maestro del catálogo de skills de la empresa — mapea la situación concreta (arrancar una tarea, tocar un endpoint, diseñar una pantalla, escribir un test, desplegar, cerrar un carril) a la skill obligatoria, y fija el orden de precedencia cuando dos se pisan. Usar al empezar cualquier trabajo para saber qué cargar, cuando no sabés si existe una skill para lo que estás por hacer, al revisar si te salteaste un gate antes de cerrar, o al incorporar a alguien al repo.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Router de skills — qué cargar y cuándo

Con más de 150 skills, el cuello de botella no es que falte conocimiento: es **encontrarlo**.
Esta skill es la tabla de ruteo. No enseña nada por sí misma; te manda a la que corresponde.

> [!important] Jerarquía de autoridad
> 1. El `CLAUDE.md` del proyecto en el que estás trabajando (hechos, comandos e invariantes reales).
> 2. Los gates de disciplina (§1): mandan sobre cualquier skill de conocimiento.
> 3. La skill específica del dominio o tecnología.
> 4. Este router.
>
> Si una skill contradice al `CLAUDE.md` del proyecto, **gana el `CLAUDE.md`**. Registrá la
> contradicción para corregir la skill después (`prompt-governance-versioning`).

## 1. Siempre — el ciclo de disciplina

Estas no son opcionales ni dependen del tipo de tarea. Son el esqueleto de todo trabajo.

| Momento | Skill | Qué te impide hacer |
|---|---|---|
| Al recibir la tarea | `outcome-first` | Empezar a leer código sin saber qué resultado observable se busca |
| Antes de investigar | `context-thrift` | Quemar contexto en dumps que no cambian ninguna decisión |
| Antes de escribir | `factual-discovery` | Asumir cómo funciona el sistema en vez de confirmarlo |
| Antes de crear algo nuevo | `anti-hallucination-guard` | Inventar una entidad, endpoint o API que ya existe o no existe |
| Antes del primer edit | `scope-discipline` | Refactorizar, renombrar o "aprovechar" fuera de lo pedido |
| Al escribir código | `native-code-patterns` | Que tu código se note distinto del vecino |
| Durante el trabajo | `progress-reporting` | Silencio largo en un trabajo de varias fases |
| Ante cualquier fallo | `root-cause-debugging` | Reintentar, silenciar o debilitar el test hasta que pase |
| Cuando te oís decir "debería" | `rationalization-guard` | Racionalizar un atajo |
| Antes de decir "listo" | `evidence-and-verification` | Afirmar sin salida literal pegada |
| Si tocaste UI | `visual-proof` | Cerrar sin mirar realmente las capturas |
| Al cerrar el turno | `finish-your-turn` | Devolver con trabajo en alcance a medias |

Si delegás en subagentes: `agent-orchestration` + `agent-resource-control`.

## 2. Por tipo de trabajo

### Backend — API
| Situación | Skills |
|---|---|
| Servicio o endpoint nuevo | `backend-development` → `nestjs-development` → `error-handling-contract` |
| Tipar DTO, respuesta, dominio | `typescript-standards` |
| Persistencia, repositorio, transacción | `database-design` · `concurrency-and-locking` |
| Query lenta, índice, DDL con tráfico | `postgresql-advanced` |
| Entidad con ciclo de vida (solicitud, cita, cotización) | `state-machines-workflows` |
| Quién es el actor | `authn-identity` · Quién puede | `authz-access-control` |
| Datos con dueño organizacional | `multi-tenancy` |
| Sacar trabajo del request | `async-messaging-events` · `background-jobs-scheduling` |
| Cachear algo | `caching-strategy` |
| Documentar el contrato | `api-openapi-docs` |
| Instrumentar / investigar sin visibilidad | `backend-observability` |

**Capacidades concretas:** notificaciones → `notifications-delivery` · archivos → `file-uploads-media` ·
buscador o listado → `search-and-filtering` · tiempo real → `realtime-websockets` ·
ubicación y cercanía → `maps-geolocation`

### Datos y modelo
| Situación | Skills |
|---|---|
| Agregar tabla, columna, relación | `model-driven-schema` → `data-modeling-plantuml` → `database-design` |
| Catálogo o enum cerrado | `terminology-value-sets` (**antes** de crear un enum) |
| Seeds, catálogos, datos "reales" | `seed-data-catalogs` |
| Validar una carga | `data-quality-validation` |
| Acción sensible que debe dejar rastro | `audit-trail-history` |
| Backups, restore, simulacro | `backup-restore-dr` |
| Script o generador Python | `python-tooling-standards` |

### Frontend web
> No hay skill de framework. Las convenciones de Next.js/React de cada repo (App Router, server vs
> client components, dónde vive el fetch, qué runtime) las fija el `CLAUDE.md` de ese repo, y
> **mandan sobre lo que diga cualquier skill de acá**. Lo de abajo es lo que no cambia con el
> framework.

| Situación | Skills |
|---|---|
| Crear un componente | `atomic-design-components` → `component-architecture-solid` |
| Formulario | `frontend-forms-ux` |
| Estilos | `css-architecture` · `frontend-design-system` |
| Estados de la vista (carga, vacío, error) | `frontend-ux-states` |
| Landing / páginas públicas | `seo-public-pages` |

### Diseño de interfaz
| Situación | Skills |
|---|---|
| Arrancar una pantalla | `frontend-ui-design` → `visual-hierarchy-composition` |
| Tokens, paleta, tipografía | `frontend-design-system` · `color-systems` · `typography-systems` |
| Pulido final / "se ve genérica" | `frontend-beautiful-ui` → `ui-quality-review` (gate) |
| ¿Se entiende? | `ux-clarity-usability` · `ux-writing-microcopy` |
| Estados de la vista | `frontend-ux-states` |
| Responsive | `frontend-responsive-layout` |
| Animación | `frontend-motion` |
| Accesibilidad | `frontend-accessibility` (diseño) + `accessibility-testing` (prueba) |
| Tablas, dashboards, iconos | `frontend-data-tables` · `dashboard-data-ui` · `iconography-imagery` |
| Navegación | `frontend-navigation-ia` |
| Performance / errores en cliente | `frontend-performance` · `frontend-error-monitoring` |
| Seguridad del cliente | `frontend-security` |
| Segundo idioma | `frontend-i18n-l10n` |

### Mobile
`mobile-ux-design` · `mobile-offline-sync` · `mobile-release-security`

> Estas tres vienen del catálogo original, escrito sobre Flutter, y quedaron por el criterio que
> cubren (táctil, offline, publicación en tiendas), no por sus ejemplos. Donde nombran un paquete
> de Flutter, el equivalente en Expo/React Native lo fija el `CLAUDE.md` de la app.

### QA y testing
| Situación | Skills |
|---|---|
| Planificar qué se prueba | `qa-strategy` → `test-plan-authoring` → `qa-orchestration` |
| Diseñar los casos | `test-case-design-techniques` + `edge-case-data-catalog` |
| Datos de prueba | `synthetic-test-data-generation` · `test-data-management` |
| Test unitario | `unit-testing` |
| Endpoint | `api-testing` |
| Integridad de datos y contratos | `integrity-testing` |
| Flujo de usuario | `e2e-playwright` → falla → `e2e-failure-triage` |
| Visual | `visual-regression-testing` |
| Carga | `performance-load-testing` |
| Seguridad automatizada | `security-testing` |
| Mantener la suite | `regression-suite-management` |
| Explorar lo no cubierto | `exploratory-testing` |
| Aceptación del negocio | `uat-acceptance-signoff` |
| Reportar para poder cerrar | `qa-evidence-reporting` |

### Seguridad
| Situación | Skills |
|---|---|
| Gate de cualquier cambio sensible | `security-guardrails` |
| Antes de construir una feature | `threat-modeling` |
| Revisar un PR sensible | `secure-code-review` |
| Evaluación sobre sistemas propios | `pentest-methodology` → `pentest-recon-mapping` → `web-app-pentest` / `api-pentest` / `auth-session-pentest` → `pentest-reporting-remediation` |
| Plataforma GitHub | `github-security-features` |
| Servidor | `server-hardening` |

### Datos de personas — **obligatorias, no opcionales**
Si el cambio toca datos de un cliente, de un comercio o de alguien del personal interno —documento
de identidad, selfie, extracto bancario, ingresos, ubicación, resultado de una evaluación de
riesgo—:
`data-privacy-sensitive` (siempre) · `authz-access-control` (quién puede verlo) ·
`audit-trail-history` (que quede rastro) · `regulatory-compliance-mapping` (bajar la norma a
controles verificables)

### Dominio negocio
`accounting-double-entry` (asientos, plan de cuentas) · `quotations-billing` (facturación y
numeración) · `state-machines-workflows` (solicitud, alta de comercio, aprobación) ·
`terminology-value-sets` (todo catálogo cerrado antes de escribir un enum)

### Calidad de código
| Situación | Skills |
|---|---|
| Escribir o revisar código | `clean-code` · `solid-principles` |
| Diseñar clases o módulos | `solid-principles` · `code-efficiency` |
| Revisar un PR | `code-review-standard` |
| Configurar el gate | `code-quality-gates` · `static-analysis-linting` |
| Elegir qué refactorizar | `code-complexity-metrics` → `technical-debt-management` |
| Refactorizar | `refactoring-safely` |
| Limpiar | `dead-code-duplication` |
| Auditar un repo | `code-quality-audit` |

### Proceso, git y entrega
| Situación | Skills |
|---|---|
| Definir la unidad de trabajo | `lane-authoring` → `requirements-and-acceptance` → `vertical-slicing` |
| Reportar un bug | `bug-reporting-standard` |
| Ramas y commits entre repos | `git-workflow-multirepo` |
| PR | `github-pull-requests` · `github-multirepo-coordination` |
| Issues y tablero | `github-issues-projects` |
| Proteger ramas | `github-branch-protection-rulesets` |
| CI | `ci-cd-pipeline` (diseño) → `github-actions-ci` (implementación) |
| `gh` desde terminal | `github-cli-automation` |
| Repo nuevo | `github-repo-standards` |
| Versionar y publicar | `github-releases-versioning` · `release-and-rollback` |
| Dependencias | `dependency-management` |
| Documentar una decisión | `technical-docs-and-adr` |
| Se cayó producción | `incident-response-postmortem` |

### Despliegue y entorno
| Situación | Skills |
|---|---|
| Desplegar en Coolify | `coolify-deployment` → `deployment-verification-smoke` |
| Operar / diagnosticar | `coolify-operations` |
| Base y backups | `coolify-databases-backups` |
| Imagen de producción | `dockerfile-production` |
| Stack local | `docker-local-stack` |
| Config y secretos | `environment-secrets-config` |
| Máquina de desarrollo (Legion, Dell Inspiron 1 y 2) | `windows-dev-environment` |

### Trabajar sobre este repo de prompts
`skill-authoring` (escribir una skill) · `prompt-engineering` (redactar el cuerpo) ·
`prompt-evals` (probar que el cambio no rompió nada) · `prompt-governance-versioning` (publicarlo) ·
`subagent-design` · `hooks-and-guardrails` · `claude-md-authoring`

## 3. Precedencia cuando dos se pisan

| Choque | Manda |
|---|---|
| Gate de disciplina vs skill de conocimiento | El **gate** |
| `data-privacy-sensitive` vs cualquier skill de feature | **`data-privacy-sensitive`** |
| `security-guardrails` vs conveniencia de implementación | **`security-guardrails`** |
| Skill general vs skill específica de la tecnología | La **específica** (`backend-development` < `nestjs-development`) |
| Diseño vs prueba del mismo tema | Ambas, en orden: diseño primero (`frontend-accessibility` → `accessibility-testing`) |
| Cualquier skill vs `CLAUDE.md` del proyecto | El **`CLAUDE.md`** |

## 4. Los cinco gates que bloquean un cierre

Ninguno se puede declarar cumplido sin salida literal pegada:

1. `evidence-and-verification` — se ejercitó el artefacto real.
2. `security-guardrails` — si el cambio toca autorización, datos o entrada de usuario.
3. `data-privacy-sensitive` — si toca datos de personas.
4. `visual-proof` — si toca UI.
5. `qa-evidence-reporting` — el reporte tiene comandos, salida y "No cubierto".

## Checklist

- [ ] Cargué las skills de disciplina del ciclo (§1), no solo la técnica del tema.
- [ ] Busqué acá antes de improvisar: si existe skill para lo que voy a hacer, la uso.
- [ ] Si el cambio toca datos de personas, cargué `data-privacy-sensitive` aunque nadie lo pidiera.
- [ ] Si dos skills se contradicen, apliqué la precedencia de §3 y registré el choque.
- [ ] Antes de cerrar, pasé por los gates de §4 que aplican.
- [ ] Si una skill me faltó, la anoté para crearla con `skill-authoring`.
