---
title: "mail-sender"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "mail-sender"
module: "MailSenderModule"
tags:
  - "backend"
  - "domain"
  - "module/mail-sender"
source_files:
  - "src/modules/mail-sender/mail-sender.module.ts"
endpoints: []
dependencies:
  - "ResilienceModule"
---
# Módulo `mail-sender`

Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.

**Papel técnico:** encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.

| | |
|---|---|
| Clase | `MailSenderModule` |
| Archivos | 4 |
| Controllers | 0 |
| Rutas HTTP | 0 |
| Modelos usados | 0 |
| Esquemas de datos | — |

## Entradas

`VERIFICADO` — el módulo **no expone rutas HTTP**. Se invoca desde otros módulos o desde el trabajo de fondo.

## Salidas y efectos

`INFERIDO` — no registra modelos propios; opera sobre datos de otros módulos o sobre infraestructura.

## Dependencias

**Depende de:** `ResilienceModule`

**Del que dependen:** [[03-domains/auth/index\|auth]], [[03-domains/customer-onboarding/index\|customer-onboarding]]

**Exporta:** `MailSenderService`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | — |
| Services | `mail-sender.service.ts` |
| Repositories | — |
| Esquemas Zod | — |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.


## Pruebas

2 archivo(s) de test:

- `test/unit/mail-sender/mail-sender.client.spec.ts`
- `test/unit/mail-sender/mail-sender.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/mail-sender/mail-sender.module.ts`](../../../../../src/modules/mail-sender/mail-sender.module.ts)


## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
