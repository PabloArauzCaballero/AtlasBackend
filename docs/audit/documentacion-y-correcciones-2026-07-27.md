# Auditoría de documentación y correcciones — 2026-07-27

## Alcance

Revisión del working tree completo de AtlasBackend, incluyendo los cambios en curso de onboarding,
ciclo de vida, elegibilidad y crédito. No se descartaron ni sustituyeron cambios locales. Se
auditaron código, configuración, CI, dependencias, pruebas y cobertura documental de las carpetas
mantenidas.

## Resultado

El backend compila, sus tipos de runtime y tests están limpios, la suite unitaria completa pasa y
las vistas PostgreSQL vigentes están disponibles. Se corrigieron problemas verificables de
seguridad, configuración, CI y documentación, además de eliminar narrativa central obsoleta. El
único desfase físico observado corresponde a una migración nueva de workflows que apareció durante
la revisión y permanece correctamente pendiente, sin aplicarla de forma implícita a la base local.

| ID              | Severidad | Problema                                                                                                                       | Corrección                                                                                                            | Justificación                                                                                                |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| DOC-20260727-01 | Media     | 171 carpetas mantenidas no tenían una explicación local uniforme; 600 archivos fuente carecían de cabecera de responsabilidad. | Generador `docs:project`, `README.md` por carpeta y JSDoc `@file/@business/@system`.                                  | Reduce conocimiento tácito y hace navegable el backend desde cualquier carpeta.                              |
| HYG-20260727-01 | Media     | `check:no-env-file` rechazaba el `.env` local ignorado que el propio README exige crear.                                       | El gate consulta `git ls-files` y solo falla si un `.env*` real está rastreado; `.example` queda permitido.           | La frontera de filtración es el índice de Git, no el filesystem del desarrollador.                           |
| SEC-20260727-01 | Alta      | `yarn audit` detectó 13 rutas vulnerables por `brace-expansion` 1.1.16; el aviso vigente afecta todas las versiones `<=5.0.7`. | Resolution 5.0.8, lockfile regenerado y peers OpenTelemetry declarados directamente.                                  | Evita un DoS por expansión de braces y hace explícitas dependencias usadas en runtime.                       |
| SEC-20260727-02 | Alta      | Configurar KMS activaba un import dinámico de un SDK ausente en dependencias de producción.                                    | Se declaró `@aws-sdk/client-kms`; la carga sigue diferida para no inicializar AWS cuando está apagado.                | Evita que una imagen correctamente configurada falle al primer cifrado de PII.                               |
| CI-20260727-01  | Media     | `type-check:tests` seguía como no bloqueante por una deuda histórica ya inexistente.                                           | Se retiró `continue-on-error`; una regresión de tipos en specs ahora bloquea CI.                                      | Los mocks forman parte del contrato y deben fallar junto con el código.                                      |
| DOC-20260727-02 | Alta      | Arquitectura y contrato narrativo afirmaban que no existía crédito y que runtime aceptaba el OTP `123456`.                     | Arquitectura/API reescritos con elegibilidad, crédito y OTP real; reportes antiguos marcados como históricos.         | Evita integrar frontends o ejecutar operaciones con premisas de seguridad falsas.                            |
| DOC-20260727-03 | Media     | El OpenAPI estaba desactualizado y su exportador exigía infraestructura viva, por lo que podía quedar bloqueado al documentar. | Exportador en modo preview de Nest y contrato regenerado con 240 rutas, incluidas onboarding, elegibilidad y crédito. | Hace reproducible el contrato sin abrir pools ni depender de proveedores externos.                           |
| CFG-20260727-01 | Media     | `.env.example` omitía 23 variables del esquema y duplicaba tres claves de circuit breaker.                                     | Plantilla completada y gate `check:env-example` en CI.                                                                | La configuración copiable vuelve a representar el contrato ejecutable sin ambigüedad de “último valor gana”. |
| TST-20260727-01 | Alta      | Las 259 suites pasaban, pero el gate de cobertura fallaba en branches/functions globales y branches de auth/crypto.            | 28 pruebas nuevas de crédito, elegibilidad, KMS y actores; el trinquete se recuperó sin rebajarlo.                    | Evita que una suite verde oculte pérdida de protección en decisiones crediticias y controles críticos.       |

## Cobertura documental

- 171/171 carpetas bajo `.github`, `config`, `docs`, `ops`, `scripts`, `src` y `test` tienen `README.md`.
- 620/620 archivos TypeScript de `src` comienzan con documentación JSDoc de archivo; 601 usan la
  cabecera uniforme `@file/@business/@system` y 19 conservan documentación específica preexistente.
- Cada README generado incluye razón de negocio, responsabilidad del sistema, inventario de archivos,
  subcarpetas y reglas de mantenimiento.
- El generador preserva README manuales y solo reescribe documentos con su marcador administrado.
- El gate de tamaño excluye únicamente estas cabeceras JSDoc, para medir código sin penalizar documentación.

## Evidencia ejecutada

| Gate                              | Resultado                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| `yarn type-check`                 | Verde.                                                      |
| `yarn type-check:tests`           | Verde.                                                      |
| `yarn lint`                       | 0 errores; 151 advertencias de complejidad/params.          |
| `yarn format:check`               | Verde antes de la generación; se repite en el cierre.       |
| `yarn test:unit --runInBand`      | 251 suites / 2.073 tests / 0 fallos.                        |
| `yarn test:coverage --runInBand`  | 263 suites / 2.191 tests / gate verde.                      |
| `yarn check:file-size`            | Verde; 34 archivos grandes permanecen como deuda congelada. |
| `yarn check:domain-schemas`       | 125 modelos con schema explícito.                           |
| `yarn check:domain-schema-layout` | Pendiente: 5 tablas de la migración nueva de workflows.     |
| `yarn check:read-api-views`       | 7 vistas reales disponibles.                                |
| `yarn check:seed-profiles`        | production=9, development=2, demo=4, test=1.                |
| `yarn check:env-example`          | 120/120 variables tipadas presentes, sin duplicados.        |
| `yarn check:overfetching`         | Verde sobre 620 archivos.                                   |
| `yarn docs:openapi`               | 240 rutas exportadas sin instanciar infraestructura.        |
| `yarn audit --level high`         | 0 vulnerabilidades después de actualizar el lockfile.       |

## Límites deliberados

- No se ejecutaron migraciones, seeds ni comandos destructivos contra la base real.
- `db:migration:status` confirma únicamente `20260728140000-create-workflow-catalog.ts` como
  pendiente; por eso el gate físico todavía no puede exigir sus cinco tablas en `platform_ops`.
- Las vistas se verificaron en modo lectura.
- Smokes que escriben datos requieren un entorno de integración controlado; CI conserva esa responsabilidad.
- Los 151 warnings de ESLint son deuda de complejidad/constructores ya visible. No se hicieron
  refactors masivos sin una métrica funcional que justificara el riesgo.
