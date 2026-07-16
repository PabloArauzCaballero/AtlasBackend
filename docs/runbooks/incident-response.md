# Runbook: respuesta a incidentes de seguridad

Procedimiento para un incidente sospechado o confirmado: fuga de credenciales,
compromiso de una clave, abuso/ataque, o exposición de datos. Objetivo: **contener
primero, investigar después**.

## 0. Clasificar (primeros 5 minutos)

Determina el tipo para saltar a la sección correcta:

- **Credencial/secreto filtrado** (clave en un log, en el repo, en un dump) → §1
- **Sospecha de sesión/cuenta comprometida** → §2
- **Abuso / ataque en curso** (fuerza bruta, scraping, DoS) → §3
- **Exposición de datos** (PII servida a quien no debía) → §4

Registra **hora de detección** y **quién** responde. Abre un canal de incidente.

## 1. Credencial o secreto filtrado

1. **Rotar de inmediato** el secreto afectado siguiendo
   [rotacion-de-claves.md](rotacion-de-claves.md) (sección A.2 para claves de cifrado, C
   para JWT).
2. Si es una credencial de base de datos, rotar la contraseña del rol afectado
   (`atlas_app_rw` / `atlas_app_ro` / `atlas_migrator`) y redeploy.
3. **Deshabilitar** (no solo reemplazar) la credencial vieja en su proveedor.
4. Confirmar que el gate `secret-scan` (gitleaks) del CI está verde en `main` y que la
   fuga no reingresa. El escaneo cubre el working tree; si el secreto entró al historial,
   trátalo como incidente cerrado con credencial rotada (política documentada en el job
   `secret-scan` de [`ci.yml`](../../.github/workflows/ci.yml)).

## 2. Sesión / cuenta comprometida

1. Revocar todas las sesiones del actor: [expiracion-y-revocacion-de-sesiones.md,
   Escenario 1](expiracion-y-revocacion-de-sesiones.md) (incrementar `tokenVersion` +
   revocar refresh tokens).
2. Forzar reset de contraseña del actor.
3. Revisar la auditoría (`audit` module) del actor: qué acciones ejecutó en la ventana
   sospechosa.
4. Si el compromiso pudo alcanzar a otros actores, ampliar el alcance (revocación
   masiva por rotación de `JWT_ACCESS_TOKEN_SECRET`).

## 3. Abuso / ataque en curso

1. **Fuerza bruta de login:** el lockout (5 intentos → 15 min) ya mitiga por credencial.
   Si el ataque es distribuido, endurecer temporalmente los rate limits de
   `login`/`refresh`/onboarding público (más estrictos que lectura autenticada) y
   confirmar que Redis respalda el rate limit distribuido en prod
   ([ADR-0002](../adr/0002-redis-solo-en-produccion.md)).
2. **Scraping / abuso de endpoints:** aplicar rate limit por endpoint/rol; bloquear
   origen si procede.
3. **DoS:** escalar a infraestructura/plataforma (WAF, límites de conexión). El backend
   por sí solo no es la capa de defensa de DoS volumétrico.

## 4. Exposición de datos

1. Contener la ruta que expone los datos (deshabilitar el endpoint/feature flag).
2. Determinar **qué** datos y **de cuántos** sujetos se expusieron (auditoría + logs,
   recordando que los logs de aplicación no deben contener PII —
   [SECURITY.md](../../SECURITY.md)).
3. Evaluar obligaciones de notificación según la normativa aplicable.

## 5. Post-incidente (siempre)

- **Timeline:** detección → contención → erradicación → recuperación.
- **Causa raíz** y **acción correctiva** con dueño y fecha (idealmente un gate de CI
  nuevo o un ADR que impida la recurrencia).
- Actualizar este runbook con lo aprendido.

## Contactos y escalamiento

> Completar por el equipo: responsable de seguridad, on-call, y canal de escalamiento a
> la plataforma de infraestructura. Mantener esta lista fuera del código fuente.
