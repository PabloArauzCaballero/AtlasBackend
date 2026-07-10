# Auditoría consolidada de seguridad, calidad y costo — 2026-07-10

## Alcance y criterio

Revisión transversal de los 24 módulos registrados en `AppModule`, configuración, guards,
interceptores, persistencia, integraciones, documentación y dependencias. Los reportes detallados
por módulo siguen en este directorio. Esta consolidación registra los hallazgos nuevos, el estado
de calidad y las decisiones de costo.

## Resultado por módulo

| Módulo                                    | Superficie principal revisada              | Estado                                                                  |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| auth                                      | JWT, refresh rotation, lockout, revocación | Endurecido: tokens dev rechazados en producción y roles validados       |
| internal-users                            | login interno y RBAC                       | Sin hallazgo nuevo bloqueante                                           |
| customers                                 | ownership y tenant isolation               | Sin hallazgo nuevo bloqueante                                           |
| customer-onboarding                       | endpoint público, rate limit, PII          | Sin hallazgo nuevo bloqueante                                           |
| sessions                                  | ownership, telemetría, idempotencia        | Sin hallazgo nuevo bloqueante                                           |
| risk / fraud                              | autorización y trazabilidad                | Sin hallazgo nuevo bloqueante                                           |
| external-data                             | SSRF, caché, cuotas y aprobación de costo  | Controles existentes adecuados; conservar deny-by-default               |
| consents / customer-privacy               | acceso público mínimo y ownership          | Sin hallazgo nuevo bloqueante                                           |
| customer-telemetry                        | tenant y payloads                          | Sin hallazgo nuevo bloqueante                                           |
| operations / data-quality / audit         | RBAC y auditoría                           | Corregida redacción del payload de auditoría                            |
| catalog-management                        | gobierno y repositorio                     | Deuda estructural por archivos grandes                                  |
| systems-ops                               | RBAC, SSRF y test runner                   | Test OpenAPI actualizado para dependencia nueva                         |
| schema-management                         | RBAC de escritura                          | Sin hallazgo nuevo bloqueante                                           |
| internal-portal                           | RBAC y consultas administrativas           | Lint corregido; servicio grande pendiente de división                   |
| notifications                             | adaptadores, retries y costo por envío     | Política de retries acotada; sin hallazgo nuevo bloqueante              |
| events / runtime-jobs / runtime-hardening | outbox e idempotencia                      | Persistencia esperada antes de responder; sin hallazgo nuevo bloqueante |
| health                                    | endpoint público                           | Respuesta no expone secretos; aceptable                                 |
| log-sync                                  | lectura de logs y Mongo                    | Regex de usuario escapada para impedir ReDoS/inyección semántica        |

## Correcciones aplicadas

1. `JwtAuthGuard` valida roles conocidos y exige `tokenVersion` más identificador de actor en
   producción. Los JWT generados por scripts locales dejan de ser credenciales de producción.
2. PostgreSQL valida certificados TLS por defecto. Producción rechaza explícitamente
   `DB_SSL_REJECT_UNAUTHORIZED=false` cuando TLS está activo.
3. La búsqueda de logs trata `q` como texto literal y no como expresión regular ejecutable.
4. El interceptor de auditoría redacta claves sensibles antes de persistir body, query y params.
5. Dependencias vulnerables actualizadas: auditoría de Yarn pasa de 8 vulnerabilidades (2 altas)
   a 0. Swagger se alinea con NestJS 11.
6. Se restauró la línea base de lint y el test OpenAPI de `systems-ops` incluye la dependencia
   agregada recientemente al controlador.

## Clases y archivos grandes

El umbral de 300 líneas es una señal, no una métrica de seguridad por sí sola. Migraciones,
seeders y fixtures declarativos se consideran excepciones justificadas: dividirlos no reduce
responsabilidades y puede volver más riesgoso el orden transaccional. No se consideran excepción
automática los componentes runtime.

Prioridad de refactor runtime:

1. `external-data.controller.ts` (~970): dividir por ejecución, gobierno y administración.
2. `external-data-execution.service.ts` (~687): separar orquestación, cuotas/costo y persistencia.
3. `internal-portal.service.ts` (~655): separar reportes, gobierno, alertas y jobs.
4. Repositorios de `catalog-management`, `systems-ops`, `notifications`, `customer-telemetry` y
   `risk` (~500–653): separar por agregado/caso de uso, evitando un repositorio fachada con acceso
   irrestricto a todas las tablas.
5. Controladores `catalog-management` y `notifications` (>300): separar lectura y comandos.

Estos refactors no se hicieron de forma masiva en esta auditoría porque el árbol ya contiene
cambios locales simultáneos en varias de esas zonas y una división mecánica elevaría el riesgo de
regresión. Deben ejecutarse módulo por módulo con pruebas de contrato.

## Eficiencia computacional y monetaria

- PostgreSQL sigue siendo la fuente transaccional correcta; Redis solo se exige en producción
  para rate limiting distribuido. Esto evita pagar Redis en desarrollo y evita límites incoherentes
  al escalar horizontalmente.
- El patrón outbox en PostgreSQL evita introducir una cola administrada antes de que el volumen lo
  justifique. Migrar a SQS/BullMQ solo cuando latencia, backlog o aislamiento de workers tengan SLO
  medido; hacerlo ahora añadiría costo fijo y operación sin beneficio demostrado.
- Los proveedores externos mantienen caché, cuotas, aprobación manual y `blockByDefault` para
  niveles caros. Es la decisión monetaria correcta. No aumentar retries de proveedores facturados:
  cada reintento puede duplicar costo y efectos.
- MongoDB para copiar `Archivo.log` añade almacenamiento, red y una conexión adicional. Es
  justificable únicamente si existe un visor operativo real. Para producción, preferir logs
  estructurados a stdout más el servicio nativo de la plataforma (CloudWatch/OpenSearch/Loki) y
  eliminar la duplicación archivo→Mongo si no hay requisito contractual.
- La paginación por cursor debe ser el camino de alto volumen; `OFFSET` se conserva solo en pantallas
  pequeñas/administrativas. `countDocuments` en cada consulta de logs duplica trabajo y puede ser
  caro: para alto volumen ofrecer cursor sin total exacto.
- KMS por campo mejora separación de claves, pero cada llamada remota tiene costo y latencia. Usar
  envelope encryption con data keys reutilizadas dentro del límite de seguridad, no una llamada KMS
  por campo. El proveedor local no es aceptable para secretos de producción.

## Verificación

- `yarn type-check`: OK.
- `yarn lint`: OK.
- `yarn audit --groups dependencies --level moderate`: 0 vulnerabilidades.
- Subconjunto de seguridad/OpenAPI: 13 suites y 70 tests pasaron inicialmente; una suite falló por
  mock faltante de `SystemsDataImpactInferenceService` y fue corregida.
- La suite completa excedió 60 segundos y el proceso fue terminado por timeout; no se registró un
  fallo funcional antes del corte. Debe correrse sin límite en CI.

## Riesgos residuales

- Falta una política automática de tamaño/complejidad en CI; conviene advertir a 300 líneas y fallar
  solo para nuevos archivos runtime por encima del umbral sin excepción documentada.
- El log de archivo recibe mensajes de terceros como texto libre. La auditoría HTTP ya se redacta,
  pero debe evitarse registrar tokens/PII en mensajes de aplicación y configurar retención/borrado.
- Validar migraciones y smoke tests contra PostgreSQL/Redis/Mongo reales requiere servicios externos;
  no queda cubierto por pruebas unitarias.
