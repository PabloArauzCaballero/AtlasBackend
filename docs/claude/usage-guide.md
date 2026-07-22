# Guía de uso — skills y comandos (Atlas)

- **Fecha:** 2026-07-21

## Skills del proyecto (invócalas por nombre)

| Necesidad | Skill | Cómo invocarla | Evidencia esperada |
|---|---|---|---|
| Implementar una feature backend | `backend-production` | "usa la skill backend-production para…" | Código + pruebas + migración + gates verdes |
| Auditoría integral por área | `backend-hardening` | "corre backend-hardening sobre…" | Informe por severidad en `docs/audit/` |
| Revisión Clean Code / arquitectura | `clean-code-review` | por nombre | Hallazgos con archivo:línea + costo real |
| Auditoría de seguridad | `security-audit` | por nombre | Matriz de riesgos + `yarn audit` |
| Auditoría de observabilidad | `observability-audit` | por nombre | Nivel de madurez + hallazgos |
| Auditoría de rendimiento | `performance-audit` | por nombre | Riesgos + cómo medirlos |
| Elegir una librería | `library-selection` | por nombre | Matriz de decisión + ADR |
| Verificar listo para producción | `production-verification` | por nombre | Tabla gate→resultado + veredicto |

## Comandos internos reales de Claude Code (verificados)

- `/security-review` — revisión de seguridad del diff actual.
- `/code-review` — revisión de correctitud del diff (o `/code-review ultra` en la nube).
- `/simplify` — limpieza de reuso/simplicidad sobre el diff.
- `/verify`, `/run` — ejercitar el cambio en el app real.
- (No inventar slash commands: estos son los disponibles en esta instalación.)

## Comandos del proyecto (package.json)

- Gates: `yarn type-check` · `yarn type-check:tests` · `yarn lint` · `yarn format:check` · `yarn test` / `test:unit` · `yarn build`.
- Dominio: `yarn check:file-size|overfetching|domain-schemas|domain-schema-layout|read-api-views|seed-profiles`.
- DB: `yarn db:migration:up|down|status` · `yarn db:seed:*` · `yarn check:db-privileges [--strict]`.
- Smokes (API arriba): `yarn smoke:*` · `yarn smoke:frontend-contract`.
- Crypto/PII: `yarn crypto:reencrypt-pii[:dry-run]`.

## Precedencia

Auditoría vigente en `docs/audit/` > código y pruebas > docs. Ante contradicción crítica, detente y explícala.
