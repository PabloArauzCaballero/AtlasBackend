---
title: "Glosario"
type: "overview"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - glossary
aliases: []
related: []
---
# Glosario

## Dominio

| Término | Significado en Atlas |
|---|---|
| **Tenant** | Organización que opera sobre Atlas. Discrimina casi todo el dato vía `_tenant_id` |
| **Cliente** (*customer*) | Persona que solicita crédito. No confundir con "cliente HTTP" |
| **Onboarding** | Recorrido de alta: identidad, contacto, dirección, consentimientos, dispositivo |
| **KYC** | *Know Your Customer* — verificación de identidad exigida por regulación |
| **Consentimiento** | Autorización explícita a tratar datos para un fin declarado. Ata cada consulta externa a su base legal |
| **Feature** | Variable derivada que alimenta la decisión de riesgo. No confundir con "funcionalidad" |
| **Evaluación de riesgo** (*assessment run*) | Una corrida del motor sobre un cliente, con sus reglas disparadas y su resultado |
| **Caso** | Expediente de revisión manual o de fraude |
| **Elegibilidad** | Estado derivado que indica si un cliente puede recibir crédito |
| **Ciclo de vida** (*lifecycle*) | Estado del cliente, con un único escritor autorizado y un `CHECK` que acota los valores |
| **Evidencia** | Documento que respalda una verificación (imagen de documento, comprobante) |

## Plataforma

| Término | Significado |
|---|---|
| **Outbox** | Tabla donde se escriben los eventos **en la misma transacción** que el cambio de negocio |
| **Rol de proceso** (`APP_ROLE`) | Si el proceso es API, worker o ambos |
| **Sonda** (*probe*) | Servidor HTTP mínimo del worker: liveness, readiness y métricas |
| **Trinquete** (*ratchet*) | Gate que compara contra una línea base: no exige perfección, exige no empeorar |
| **Modelo de lectura** | Esquema `read_api` con vistas versionadas que aíslan de la forma física |
| **Envelope encryption** | Una *data key* cifra el valor; la clave maestra cifra la data key |
| **Clave de idempotencia** | `x-idempotency-key` + hash del cuerpo: distingue reintento de comando nuevo |
| **Correlation id** | Identificador de request presente en logs, respuesta y traza |
| **Perfil de seed** | `production`, `development`, `demo` o `test` — qué datos se siembran |

## Convenciones de datos

| Término | Significado |
|---|---|
| `_id` | Clave primaria sustituta. **No** se expone públicamente |
| `_tenant_id` | Discriminador de tenant |
| `_deleted` | Borrado lógico |
| `*_hash` | PII hasheada, para buscar sin descifrar |
| `*_encrypted` | PII cifrada — el valor real |
| `*_last_4` | Fragmento mostrable |
| **BOLA** | *Broken Object Level Authorization* — leer objetos de otro usuario cambiando el id |
| **BFLA** | *Broken Function Level Authorization* — invocar funciones de otro rol |

## Etiquetas de evidencia de esta bóveda

| Etiqueta | Significado |
|---|---|
| `VERIFICADO` | Evidencia directa en el código |
| `INFERIDO` | Deducción razonable, no confirmada |
| `NO_CONFIRMADO` | Faltan datos |
| `RIESGO` | Comportamiento potencialmente problemático |
| `PENDIENTE` | Requiere revisión humana o ejecución del sistema |

## Relaciones

- [[01-overview/project-overview]] · [[05-data/data-dictionary]]
