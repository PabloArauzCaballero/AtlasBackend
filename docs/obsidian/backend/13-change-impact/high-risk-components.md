---
title: "Componentes de alto riesgo"
type: "audit"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - change-impact
aliases: []
related: []
---
# Componentes de alto riesgo

Dónde un error se paga caro. Ordenado por consecuencia, no por probabilidad.

## 1. Cifrado de PII

`envelope-encryption.util.ts`, `kms-key-provider.ts`

**Si falla:** datos ilegibles (pérdida) o en claro (fuga). El `providerId` embebido es lo que permite convivir proveedores; romperlo inutiliza los valores existentes.

**Cuidado especial:** el proveedor se fija en **ambos** entrypoints. Cambiarlo solo en uno produce valores cifrados con proveedores distintos según qué proceso escribió.

## 2. Cadena de guards

`jwt-auth.guard.ts`, `roles.guard.ts`, `tenant.guard.ts`

**Si falla:** acceso indebido a datos de otros clientes o funciones de otros roles.

**Cuidado especial:** el orden importa. `RolesGuard` sin `@Roles` deja pasar a cualquier autenticado.

## 3. Cadena de interceptores

`app.module.ts:101-116`

**Si falla:** afecta a las 266 rutas. Cada posición tiene una razón escrita: métricas fuera para medir todo, timeout dentro para que su 503 se mida, auditoría antes de idempotencia para registrar los *replays*.

**Cuidado especial:** reordenar sin leer los comentarios rompe garantías que no son evidentes.

## 4. `CustomersModule`

12 de 27 módulos dependen de él y exporta `CustomersRepository`.

**Cuidado especial:** ampliar sus exports amplía la superficie de acoplamiento. Cada export nuevo necesita justificación transaccional documentada.

## 5. Catálogo de jobs y su planificador

**Si falla:** eventos sin publicar, sesiones sin expirar, retención sin aplicar — todo en silencio, sin error visible para ningún usuario.

**Cuidado especial:** añadir un job **no** debe tocar `runtime-jobs-scheduler.service.ts`. Si hace falta, algo se sale del patrón.

## 6. Migraciones

**Si falla:** el esquema queda a medias, o incompatible con las réplicas en curso.

**Cuidado especial:** probar `up → down → up`. Recordar que corren **antes** que el código nuevo.

## 7. `domain-schemas.ts`

Fuente única del mapa tabla → esquema, compartida por modelos y migraciones.

**Si falla:** modelos apuntando al esquema equivocado. `atlasSchemaFor()` lanza si falta una tabla, lo que convierte el error en un fallo de arranque en vez de una consulta silenciosa a la tabla equivocada.

## 8. `reclaim_stuck_events`

**Si falla:** vuelve la pérdida silenciosa de eventos que el diseño del outbox cerró. Los eventos quedan en `processing` y **nadie los mira**.

## 9. Filtro de excepciones

**Si falla:** o se filtra estructura interna al cliente, o se pierde la causa real en el log. Mantiene dos mensajes distintos a propósito.

## Regla común

Todos estos componentes tienen algo en común: **fallan en silencio**. No producen un error visible para el usuario, sino datos incorrectos, accesos indebidos o trabajo que no se hace. Por eso importan más que los caminos ruidosos.

## Relaciones

- [[13-change-impact/dependency-impact-map]] · [[14-audits/risks-register]] · [[11-quality/quality-gates]]
