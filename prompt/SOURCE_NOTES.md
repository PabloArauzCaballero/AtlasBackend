# Source Notes

Este paquete fusiona y corrige los prompts entregados por el usuario para ajustarlos a Proyecto Atlas.

## Fuentes usadas

- Brief de producto Atlas: BNPL Bolivia, regla 60/40, 3 cuotas, MDR, no aceleración de deuda, tres frentes de producto y roadmap por módulos.
- Stack Atlas: Next.js + React Native, NestJS + TypeScript, PostgreSQL + Redis, AWS + Terraform, monolito modular para MVP.
- Prompts originales: `index.md`, `programacionGeneral.md`, `programacionBackend.md`, `CLAUDE.md`, `CLAUDE_BACKEND.md`, `CLAUDE_FRONTEND.md`, `BACKEND_DEVELOPMENT_CONTEXT.md`, `FRONTEND_DEVELOPMENT_CONTEXT.md`, `CONTRIBUTING.md`, `GUIA.md`.
- Material de scorecards: se usó solo como guía conceptual general para exigir scoring auditable, versionado, con reason codes, validación y monitoreo. No se copió contenido extenso.

## Conflictos corregidos

- Los contextos anteriores hablaban de FastAPI, Python, Pydantic, asyncpg, Celery y Alembic. Eso fue reemplazado por NestJS, TypeScript, Sequelize, Zod, JWT y workers Node.
- Los contextos anteriores imponían multi-tenancy con `_tenant_id`. Para Atlas se cambió por scoping correcto por usuario, comercio, rol y ownership, dejando `tenantId` solo si el schema futuro lo define.
- Los contextos anteriores decían English-only para UI. Para Atlas se corrigió: identificadores técnicos en inglés; UI mediante i18n con español Bolivia inicial.
- Se agregó soporte explícito para ChatGPT, no solo Claude.
- Se agregó contexto mobile, inexistente en los prompts originales.
- Se agregó contexto de infraestructura AWS coherente con MVP.

- Se agregó control obligatorio de pendientes en Markdown mediante `PENDIENTES_ATLAS.md`, `prompt/PENDIENTES.md` y una sección fundamental dentro de `prompt/index.md`.
