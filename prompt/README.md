# Atlas AI Context Pack

Paquete corregido y fusionado de prompts para desarrollar **Proyecto Atlas** con el stack acordado.

Este paquete sirve para trabajar tanto con **Claude / Claude Code** como con **ChatGPT**. No es código fuente de la aplicación; es el set de instrucciones, contexto y reglas que se debe adjuntar o colocar en el repositorio antes de pedir generación, revisión o modificación de código.

## Stack Atlas fijado

- **Backend:** NestJS + TypeScript + Sequelize / `sequelize-typescript` + PostgreSQL + Zod + JWT.
- **Web:** Next.js 15 App Router + TypeScript strict + Tailwind CSS + shadcn/ui / Radix.
- **Mobile:** React Native + Expo + TypeScript.
- **Datos y estado:** PostgreSQL como fuente transaccional; Redis para caché, rate-limit, sesiones efímeras y colas si aplica.
- **Infraestructura:** AWS con ECS Fargate, RDS PostgreSQL, ElastiCache Redis, S3, CloudFront, WAF, KMS, Secrets Manager, CloudWatch, CloudTrail, Terraform y GitHub Actions.
- **Arquitectura:** monolito modular en backend, frontends separados, evolución a microservicios solo cuando la escala lo justifique.

## Cómo usarlo con Claude

1. Copia `CLAUDE.md` en la raíz del repositorio.
2. Copia los contextos relevantes al repositorio:
   - `BACKEND_DEVELOPMENT_CONTEXT.md` para `apps/api`.
   - `FRONTEND_WEB_DEVELOPMENT_CONTEXT.md` para `apps/web`.
   - `MOBILE_DEVELOPMENT_CONTEXT.md` para `apps/mobile`.
   - `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` para `infra`.
3. En Claude Code, el archivo `CLAUDE.md` funciona como punto de entrada.
4. Para sesiones cortas puedes usar los archivos `quick/CLAUDE_*.md`.

## Cómo usarlo con ChatGPT

Adjunta o pega primero:

1. `CHATGPT.md`
2. `PROMPT_MASTER_ATLAS.md`
3. El contexto específico según la tarea:
   - Backend: `BACKEND_DEVELOPMENT_CONTEXT.md`
   - Web: `FRONTEND_WEB_DEVELOPMENT_CONTEXT.md`
   - Mobile: `MOBILE_DEVELOPMENT_CONTEXT.md`
   - Infra: `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md`
4. Si pides generación completa o ZIP, adjunta también `CHECKLIST_FINAL.md`.

## Archivos principales

| Archivo | Uso |
|---|---|
| `CLAUDE.md` | Entry point para Claude y Claude Code. |
| `CHATGPT.md` | Entry point para ChatGPT. |
| `PROMPT_MASTER_ATLAS.md` | Prompt unificado de máxima prioridad para cualquier IA. |
| `PROJECT_BRIEF_ATLAS.md` | Resumen operativo de producto y reglas de negocio. |
| `PENDIENTES_ATLAS.md` | Registro base de decisiones abiertas, bloqueos, supuestos y pendientes de producto. |
| `BACKEND_DEVELOPMENT_CONTEXT.md` | Reglas concretas para NestJS, Sequelize, Zod, JWT y workers. |
| `FRONTEND_WEB_DEVELOPMENT_CONTEXT.md` | Reglas para portal comercio y panel operaciones con Next.js. |
| `MOBILE_DEVELOPMENT_CONTEXT.md` | Reglas para app consumidor con React Native + Expo. |
| `INFRASTRUCTURE_DEVELOPMENT_CONTEXT.md` | Reglas AWS/Terraform/CI-CD/observabilidad. |
| `CONTRIBUTING.md` | Git, PRs, ramas, migraciones y Definition of Done. |
| `prompt/` | Versión modular de los prompts para adjuntar por área. Incluye `prompt/PENDIENTES.md`. |
| `quick/` | Entradas rápidas para Claude y ChatGPT. |

## Correcciones aplicadas respecto a los prompts originales

- Se eliminó la contradicción FastAPI/Python/Alembic vs. NestJS/TypeScript/Sequelize.
- Se sustituyó Express puro por NestJS como backend obligatorio.
- Se agregó soporte explícito para ChatGPT además de Claude.
- Se incorporó mobile como primer frente real: React Native + Expo.
- Se alineó frontend web con Next.js 15 y el portal de comercios / operaciones.
- Se incorporaron reglas de negocio Atlas: BNPL, 60/40, 3 cuotas, MDR, no aceleración de deuda, auditoría y riesgo.
- Se añadió infraestructura AWS pragmática para MVP y crecimiento.
- Se añadió regla obligatoria para que todo pendiente quede marcado en Markdown, especialmente en `prompt/index.md`, `PENDIENTES_ATLAS.md` y `prompt/PENDIENTES.md`.
- Se corrigió la regla de multi-tenancy: Atlas debe estar preparado para aislar datos por usuario, comercio y rol; no se debe imponer `_tenant_id` universal si el modelo de datos no lo definió.
- Se diferencian tablas financieras/auditoría append-only de tablas administrativas que sí pueden usar soft delete.

## Nota importante

Si un requisito crítico no está definido, la IA debe detenerse y pedir aclaración. Atlas maneja crédito, KYC, riesgo, pagos, comercios y datos sensibles: inventar reglas aquí sería peligroso.


## Control de pendientes

Este paquete incluye una regla fundamental: todo pendiente debe quedar señalado en Markdown. Para Atlas, usa `PENDIENTES_ATLAS.md` como referencia base y `prompt/PENDIENTES.md` como instrucción operativa para Claude, ChatGPT y otras IAs. En proyectos generados, crea o actualiza `docs/pending/pending-items.md`.
