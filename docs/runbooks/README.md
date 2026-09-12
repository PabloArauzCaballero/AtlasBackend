# Runbooks operativos

Procedimientos paso a paso para operar AtlasBackend en incidentes y tareas periódicas.
Un runbook está escrito para ejecutarse **bajo presión, sin pensar de cero**: pasos
concretos, comandos reales del repo y criterios de verificación.

| Runbook | Cuándo se usa |
|---------|---------------|
| [rotacion-de-claves.md](rotacion-de-claves.md) | Rotación programada o de emergencia de secretos de cifrado (envelope/KMS) y JWT |
| [incident-response.md](incident-response.md) | Sospecha de compromiso, fuga de credenciales, abuso o caída |
| [expiracion-y-revocacion-de-sesiones.md](expiracion-y-revocacion-de-sesiones.md) | Revocar sesiones/tokens de un actor o de toda la flota |
| [despliegue-produccion.md](despliegue-produccion.md) | Checklist de despliegue a producción (env vars, migraciones, KMS, 2FA, observabilidad) |
| [events-recovery-v2.md](events-recovery-v2.md) | Eventos `failed`/cuarentena en el outbox, leases vencidos, consumidores atascados, replay autorizado |
| [transition-migration-recovery.md](transition-migration-recovery.md) | actualización de instalaciones existentes: qué revierte cada acción, ventana de compatibilidad, relleno por lotes reanudable (AT-053). |
| [messaging-single-writer-cutover.md](messaging-single-writer-cutover.md) | corte de escritor único de Mensajería: estado, drenado, transferencia por época, comprobación y reversión (AT-059). |
| [messaging-shadow-read.md](messaging-shadow-read.md) | copia por lotes de Mensajería al piloto (reanudable, marca de agua, reconciliación por hash) y lectura sombra sin proveedores (AT-058). |
| [messaging-rollback-after-writes.md](messaging-rollback-after-writes.md) | reversión del piloto tras escrituras nuevas: transferencia inversa por época, nada perdido, nada repetido (AT-060). |

> Los comandos asumen las variables de entorno del entorno objetivo ya cargadas. Verifica
> siempre `NODE_ENV` **antes** de ejecutar nada destructivo.
