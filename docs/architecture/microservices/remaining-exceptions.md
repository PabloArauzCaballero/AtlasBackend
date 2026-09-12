# Excepciones que quedan tras el piloto de Mensajería (AT-061)

Gate: `test/architecture/messaging-extraction-complete.spec.ts` (línea base congelada; sólo encoge).

## Lo que se retiró en F9

- El piloto compone Mensajería **sin** `NotificationsModule`, `CustomersModule`, `InternalUsersModule` ni `AppModule`.
- Arranca con `atlas_ctx_messaging`; PostgreSQL deniega Crédito/Clientes/IAM (AT-019, AT-057) y la guarda de arranque
  rechaza correr con otra identidad.
- El relay del monolito sólo reclama mientras sea dueño (`context_ownership`); el corte y la reversión están ensayados.

## Lo que NO se retiró (y por qué)

| Excepción                                                         | Dónde                                                  | Por qué sigue                                                                                                                                                                                    | Retira                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Directorio de destinatarios sin configurar                        | `RemoteRecipientDirectoryAdapter` (fallback)           | el contrato HTTP existe (`CustomerRecipientDirectoryController` + `HttpRecipientDirectoryAdapter`); sin `CUSTOMERS_DIRECTORY_URL`/`CONTEXT_SERVICE_TOKEN_SECRET` el worker no entrega a clientes | configurar ambas variables en el despliegue del piloto              |
| `CustomerContactMethodModel` registrado en el worker              | `MESSAGING_WORKER_MODELS`                              | `NotificationsRepository` lo inyecta para el fallback legado; nunca se consulta con el directorio remoto y el rol no podría leerlo                                                               | AT-025 (repositorio sin fallback)                                   |
| Configuración: esquema único                                      | `env.ts` importado por cada dependencia                | el perfil `ATLAS_CAPABILITY_PROFILE=messaging` relaja lo que el worker no usa (JWT de usuarios, Redis); el esquema sigue siendo el común, con valores por defecto para lo ajeno                  | dividir el esquema por capacidad cuando el piloto tenga base propia |
| Difusión a usuarios internos                                      | `NotificationBroadcastService` (lee `iam`, `customer`) | queda en el monolito; el piloto no la compone                                                                                                                                                    | decisión de producto: ¿es Mensajería o IAM?                         |
| Importadores internos (16 archivos)                               | ver `LEGACY_IMPORTERS` en el gate                      | relay v1, jobs de entrega, OTP en Onboarding, mail-sender, monitor de salud                                                                                                                      | AT-025/AT-040; apagar relay v1 por defecto                          |
| Exportaciones legadas de `NotificationsModule` (8)                | `notifications.module.ts`                              | consumidores anteriores a AT-017                                                                                                                                                                 | migrar cada consumidor al puerto                                    |
| Grants legados                                                    | `atlas_app_rw` sigue pudiendo escribir `messaging.*`   | el monolito ES el dueño hasta la transferencia; retirar el grant antes del corte rompería el relay v1                                                                                            | tras el corte definitivo (segunda versión de `context-roles.sql`)   |
| Modelos agregados en `database-models.ts` / `sequelize.module.ts` | monolito                                               | mientras se comparta proceso, el monolito registra todos los modelos (AT-018); no se toca                                                                                                        | base propia del piloto                                              |
| Corte por tenant (canary)                                         | `context_ownership` es por contexto                    | no hay partición por tenant                                                                                                                                                                      | diseño posterior                                                    |
| Puente atómico del alta                                           | `LegacyOnboardingAtomicBridge` (AT-015)                | Onboarding no es extraíble hasta tener estados provisionales y compensación                                                                                                                      | AT-015/plan posterior                                               |

## Estado de plataforma

Que Mensajería tenga un piloto **no** convierte a Crédito ni a Clientes en extraídos: su estado se evalúa por su propia
evidencia en `readiness.json` (AT-062).
