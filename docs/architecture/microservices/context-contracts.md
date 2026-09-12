# Contratos entre contextos y excepciones vigentes (AT-011)

Fuente de verdad: `config/architecture/boundaries.json` (manifiesto) y `boundaries-baseline.json` (deuda congelada).
Lo aplica `yarn check:architecture` (AT-012) en CI. Este documento explica lo que el JSON no puede.

## Regla

Un archivo de `src/modules/A` puede importar de `src/modules/B` si, y sólo si:

1. A y B están en el **mismo contexto** (por ejemplo `loans` y `loan-payment-claims` en `loan-book`), o
2. `modules.A.allowedDependencies` incluye a B, o
3. una **excepción vigente** (con `owner`, `task` y `expires`) lo cubre, o
4. el archivo es un **composition root** (`*.module.ts`, `app.module.ts`, `main.ts`, `worker.ts`, `src/bootstrap/**`): ahí se
   compone implementación concreta a propósito, y no se exige invertir la raíz.

Las carpetas técnicas (`common`, `config`, `database`, `observability`, `platform`, `bootstrap`, `worker`) las puede importar
cualquier módulo. El dominio (`src/modules/*/domain/**`) sólo puede importar su propio módulo: nada de Nest, Sequelize, HTTP,
Redis ni `process.env`. Un contrato público (`src/modules/*/public/**`) no exporta modelos ORM, repositorios ni `Transaction`.

## Estado al 2026-09-11 (dev)

| Medida | Valor |
|---|---|
| Aristas entre módulos | 299 (inventario AT-003) |
| Permitidas por contexto, lista o composición | 184 |
| **Congeladas en la línea base** | **118**: 115 dependencias entre contextos, 3 de pureza de dominio (`support/domain` importa `@nestjs/common` y utilidades de `common`) |
| Ciclos | 1, cubierto por la excepción `auth-mail-cycle` |
| Excepciones | 2 |

Los peores importadores fuera de contexto: `credit` 19, `runtime-jobs` 13, `customer-onboarding` 9, `partner-onboarding` 9,
`auth` 7, `loan-payment-claims` 7. La línea base **sólo puede encoger** (`--update-baseline` rechaza crecimiento sin
`--allow-growth`, que debe justificarse en la revisión).

## Dependencias permitidas hoy (y por qué)

| Módulo | Puede depender de | Motivo |
|---|---|---|
| `customer-onboarding`, `mobile-identity`, `customer-privacy` | `customers` | El cliente es el agregado que estos contextos completan o protegen; la lectura por contrato llega en AT-024. |
| `credit` | `customers` | La admisión consume elegibilidad (`CustomerEligibilityService`) y la bloquea; se sustituye por `CreditAdmissionPort` en AT-026. |
| `loans`, `loan-payment-claims` | `credit` | La cartera nace de una solicitud aprobada. |

Todo lo demás que hoy cruza un contexto está en la línea base como deuda con nombre de archivo.

## Excepciones vigentes

| id | Tipo | De → a | Dueño | Retirada | Vence |
|---|---|---|---|---|---|
| `onboarding-atomic-bridge` | puente transaccional | `customer-onboarding` → `auth`, `consents`, `sessions` | datos | AT-015 encapsula (hecho), AT-025 descompone | 2027-03-31 |
| `auth-mail-cycle` | ciclo | `auth` ↔ `internal-users` ↔ `mail-sender` ↔ `notifications` | mensajería | AT-039/AT-040 | 2027-03-31 |

Una excepción vencida deja de cubrir y el gate vuelve a marcar las aristas: la fecha es un compromiso, no decoración.

## Entradas públicas

| Módulo | Entrada | Qué expone |
|---|---|---|
| `notifications` | `src/modules/notifications/public/index.ts` (AT-017) | `NotificationRequestPort` + token, contratos de solicitud/resultado, catálogos de canal y destinatario. Nada más. |

El resto de módulos aún no tiene entrada pública: sus consumidores importan implementación y eso es lo que la línea base
congela. Cada contexto que gane entrada pública en F4 añade una fila aquí y vacía la suya en la línea base.

## Estado de extracción por contexto

| Contexto | Estado | Bloqueador |
|---|---|---|
| Mensajería | modular; candidato a piloto (F9) | ciclo con `auth`/`internal-users`; exportaciones legado del módulo |
| Crédito y admisión | modular, límite consistente cerrado (F1) | admisión comparte transacción con Clientes: no extraíble por diseño |
| Onboarding | **modular, no extraíble** | puente atómico heredado |
| Resto | monolito modular en curso | línea base de dependencias, tablas compartidas (AT-020/021) |
