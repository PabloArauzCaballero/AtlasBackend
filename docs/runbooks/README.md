# Runbooks operativos

Procedimientos paso a paso para operar AtlasBackend en incidentes y tareas periódicas.
Un runbook está escrito para ejecutarse **bajo presión, sin pensar de cero**: pasos
concretos, comandos reales del repo y criterios de verificación.

| Runbook | Cuándo se usa |
|---------|---------------|
| [rotacion-de-claves.md](rotacion-de-claves.md) | Rotación programada o de emergencia de secretos de cifrado (envelope/KMS) y JWT |
| [incident-response.md](incident-response.md) | Sospecha de compromiso, fuga de credenciales, abuso o caída |
| [expiracion-y-revocacion-de-sesiones.md](expiracion-y-revocacion-de-sesiones.md) | Revocar sesiones/tokens de un actor o de toda la flota |

> Los comandos asumen las variables de entorno del entorno objetivo ya cargadas. Verifica
> siempre `NODE_ENV` **antes** de ejecutar nada destructivo.
