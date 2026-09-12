# Gates de la transición en el pipeline (AT-055)

`.github/workflows/ci.yml` conserva todo lo que tenía (frozen-lockfile, lint, formato, type-check, type-check:tests,
unit aleatorizado, cobertura con trinquete, documentación/OpenAPI, migraciones up→down→up, privilegios, CodeQL,
gitleaks, SBOM) y añade en el job `backend`, con código de salida propio:

| Paso | Script | Falla cuando |
|---|---|---|
| Architecture boundaries | `yarn check:architecture` (ya existía, AT-012) | una importación nueva viola el manifiesto o la línea base crece |
| Architecture tests | `yarn test:architecture` | fuga nueva de ORM/framework en puertos, mapa de contextos desalineado, umbral de cobertura huérfano |
| Contract tests | `yarn test:contracts` | un doble o un adaptador deja de cumplir el contrato del puerto; una frontera de seguridad cambia |

En `db-and-cache-integration`, `yarn test:integration` ya corre contra PostgreSQL real e incluye ahora la actualización
de instalaciones (`test/integration/migrations`), el recorrido crítico (`journeys`), la matriz de fallos (`resilience`)
y el gate en negativo de base obligatoria (`testing`). Un job `skipped` no es aprobación: no hay `continue-on-error` ni
`--passWithNoTests` (vigilado por `required-database-gate.spec.ts`).

## Lo que NO se afirma

- **Branch protection / required checks:** no se ha verificado ni configurado; requiere permisos de administración del
  repositorio. Queda **pendiente explícito**: el YAML cambia, la protección no.
- **Pipeline ejecutado en PR:** este cambio no se ha empujado (empujar `dev` despliega por Coolify). La ejecución en CI
  se verá en el primer PR que lo lleve.
