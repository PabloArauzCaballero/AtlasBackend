# Resultados de smoke tests (JSON)

Los smoke tests siguen generando un archivo `.json` con cada llamada realizada (método, ruta,
rol, body, status, respuesta). Esto es intencional y no se desactiva — sirve para depuración,
comparación de contratos y diagnóstico de fallos en CI. La única regla es que **ese archivo nunca
debe quedar rastreado por Git**, porque incluso redactado puede contener detalles operativos que
no queremos versionados permanentemente.

## Dónde quedan

```text
scripts/smoke/results/*.json
```

El directorio se crea automáticamente (`writeSmokeResults()` en `scripts/smoke/http.ts`) y está
en `.gitignore`. Ejecutar `yarn smoke` (la suite agregada, `scripts/smoke/index.ts`) genera
`scripts/smoke/results/smoke-results.json` al final de la corrida, con éxito o con fallo.

Nota: los comandos individuales `yarn smoke:core`, `yarn smoke:auth`, etc. (los que corre CI) no
escriben su propio JSON hoy — solo el runner agregado `yarn smoke` lo hace. Escribir un resultado
por suite individual queda pendiente como mejora futura (ver `docs/progress/remediation-register.md`,
ATLAS-P0-SMOKE-001).

## Contrato del archivo

```json
{
  "schemaVersion": "1.0.0",
  "suite": "all",
  "generatedAt": "2026-07-14T00:00:00.000Z",
  "commitSha": "...",
  "environment": "development",
  "summary": { "total": 0, "passed": 0, "failed": 0 },
  "calls": []
}
```

`commitSha` sale de `GITHUB_SHA` en CI, o de `git rev-parse HEAD` en local (`"unknown"` si ninguno
está disponible). La escritura es atómica: se escribe primero un `.tmp` y se hace `rename` al
archivo final, así un fallo a mitad de escritura nunca deja un JSON corrupto/truncado como si
fuera un resultado válido.

## Redacción

Antes de serializar, cada `requestBody`/`responseData` pasa por `redactSensitive()`
(`scripts/smoke/redact.ts`), que:

- Reemplaza el valor completo de cualquier clave sensible (`password`, `accessToken`,
  `refreshToken`, `authorization`, `cookie`, `apiKey`, `clientSecret`, `privateKey`, `tokenHash`,
  `otp`, `mfaCode`, `recoveryCode`, sin importar mayúsculas/minúsculas) por `[REDACTED]`.
- Detecta y redacta JWT completos, incluso bajo una clave no sensible o embebidos dentro de un
  string más largo.
- Redacta headers `Bearer <token>`, bloques PEM (`-----BEGIN ... -----END ...-----`) y
  credenciales embebidas en URLs (`user:pass@host`).
- Nunca muta el objeto original.

Pruebas: `test/unit/smoke/smoke-redaction.spec.ts`.

## Gate en CI

`yarn check:smoke-results-untracked` (`scripts/check-no-tracked-smoke-results.ts`) corre en CI
antes de lint/type-check/tests y falla el build si `git ls-files` encuentra cualquier archivo bajo
`scripts/smoke/results/`, `scripts/smoke/smoke-results.json` o `scripts/smoke/*.results.json` —
sin importar cómo haya llegado ahí (`.gitignore` protege el flujo normal; este gate protege contra
un `git add -f` explícito o un commit hecho antes de que el gate existiera).

## Verificación manual

```bash
yarn smoke:auth              # o `yarn smoke` para la suite completa
git check-ignore -v scripts/smoke/results/smoke-results.json   # debe imprimir la regla aplicada
git ls-files scripts/smoke/results scripts/smoke/smoke-results.json 'scripts/smoke/*.results.json'
                              # no debe imprimir nada
yarn check:smoke-results-untracked   # exit code 0
```
