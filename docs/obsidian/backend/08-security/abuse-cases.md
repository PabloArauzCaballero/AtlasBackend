---
title: "Casos de abuso"
type: "security"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - security
aliases: []
related: []
---
# Casos de abuso

Uso legítimo llevado al extremo, o uso indebido por parte de alguien con acceso válido. No son ataques desde fuera: eso está en [[08-security/threat-model]].

| Caso | Actor | Control existente | Suficiencia |
|---|---|---|---|
| Enumerar clientes cambiando el id de la URL | Cliente autenticado | Ownership anti-BOLA + identificadores públicos UUID/código, no el `_id` secuencial | ✅ |
| Probar credenciales de forma masiva | Anónimo | `@Throttle` estricto + bloqueo tras 5 intentos durante 15 min | ✅ |
| Agotar la cuota de un proveedor externo | Cliente o interno | `external_provider_cost_policies` + circuit breaker | ✅ |
| Provocar envío masivo de notificaciones | Cliente | Cooldown por destino | ✅ |
| Reenviar el mismo comando muchas veces | Cliente | Clave de idempotencia + hash del cuerpo | ⚠️ solo si el endpoint la exige |
| Subir archivos enormes o maliciosos | Cliente | Límite de 2 MB + antimalware previo | ✅ |
| Listar con paginación profunda para cargar la base | Cualquiera | `limit` máximo 100 + paginación por cursor | ✅ |
| Operador interno consultando clientes sin motivo | Interno | Auditoría por acción (`customer_action_logs`, esquema `audit`) | ⚠️ **detecta, no impide** |
| Operador interno exportando datos en masa | Interno | Gate de sobrelectura + auditoría | ⚠️ ídem |
| Disparar jobs manualmente en bucle | Interno con rol `system` | `dryRun: true` por defecto en los DTO | ✅ |
| Reutilizar un token tras el cambio de rol | Interno | `tokenVersion` permite revocar | ✅ |

## El patrón que se repite

> [!info] Contra el abuso interno, el control es la trazabilidad
> Un operador con rol legítimo **puede** consultar datos que no necesita: impedirlo exigiría autorización por caso de uso, no por rol. Lo que Atlas hace es dejar **rastro completo** — cada acción HTTP se registra, y `customer_action_logs` guarda quién tocó a qué cliente.
>
> Es una elección consciente: detección en vez de prevención. Funciona si alguien revisa esos registros. Sin revisión, el control existe pero no actúa.

## Lo que falta

`PENDIENTE`:

- **Detección de anomalías** sobre el comportamiento de operadores internos (picos de consulta, accesos fuera de horario).
- **Límites por actor**, no solo por IP: el rate limiting no distingue a un operador que consulta 10 000 clientes.
- **Alerta sobre exportaciones masivas.**

## Relaciones

- [[08-security/threat-model]] · [[08-security/authorization]] · [[09-observability/alerts]]
