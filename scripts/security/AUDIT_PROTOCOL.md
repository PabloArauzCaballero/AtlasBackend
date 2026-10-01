# Auditoría de dependencias: protocolo y contrato (ATL-11)

Fuente: `lib/cli.js` de Yarn Classic 1.22.22 (comando `audit` + `JSONReporter`) y una corrida real
(`yarn audit --json`: N × `auditAdvisory` + 1 × `auditSummary`, exit = máscara del resumen).

## Por qué el bloque anterior mentía

`yarn audit` devuelve una máscara de bits (1 info, 2 low, 4 moderate, 8 high, 16 critical). Un error
operativo de yarn (DNS, 5xx, registro caído) también sale con **1**, igual que «sólo INFO». El bloque
`codigo & 24` aprobaba cualquier valor sin los bits 8/16: exit 1 sin reporte, o 32. Era una debilidad del
control, no una CVE: no prueba que ningún run anterior ocultara vulnerabilidades.

## Contrato

Una auditoría se acepta sólo si es **completa**:

1. El proceso arrancó, terminó (sin señal ni timeout) y su salida no se truncó.
2. stdout/stderr son JSON-lines íntegras (stderr tolera avisos de runtime de Node `(node:PID)`).
3. No hay registros `error` (stdout ni stderr), ni tipos desconocidos.
4. Hay **exactamente un** `auditSummary`, es el último registro de stdout, con las cinco severidades y los
   cuatro contadores enteros no negativos y `totalDependencies > 0`.
5. El exit code es **igual** a la máscara que implica el resumen (exit 1 con resumen INFO ⇒ válido; exit 1
   con resumen limpio, o 32 ⇒ rechazo). Un `auditAdvisory` de una severidad con contador 0 contradice el resumen.

Sólo entonces se aplica la política (HIGH/CRITICAL bloquean; la política vigente no cambió). `--level` no se
usa: sólo filtra lo impreso y el resumen cuenta todo. No se pasa `--groups`: ámbito por defecto de yarn.

| Salida del gate | Significado |
|---|---|
| 0 | PASS (auditoría completa sin hallazgos bloqueantes, o todos con excepción vigente) |
| 2 | BLOCKED_FINDINGS |
| 3 | OPERATIONAL_ERROR (reporte ausente, inválido, timeout, señal, truncado) |
| 4 | INVALID_CONFIGURATION (sin `yarn.lock`, yarn no es 1.x, variables mal formadas, excepciones ilegibles) |

El código de yarn queda en la evidencia (`yarnExitMask`, `attempts[].yarnExitCode`), no se mezcla con el del gate.

## Excepciones

Archivo opcional de excepciones (por defecto `audit-exceptions.json` dentro de `.github/`, variable `AUDIT_EXCEPTIONS_FILE`; hoy no hay ninguno y **no se crean excepciones para mejorar la nota**):
`{"exceptions":[{"advisory":"<id o GHSA>","owner":"<rol>","reason":"…","expires":"<ISO-8601>"}]}`.
Sin responsable, motivo o vigencia, o caducada ⇒ no vale. Nunca cubre un error operativo ni hallazgos que el
resumen cuenta y los avisos no detallan.

## Reintentos y evidencia

Presupuesto por intento `AUDIT_TIMEOUT_MS` (300 s), salida `AUDIT_MAX_OUTPUT_BYTES` (16 MiB), `AUDIT_ATTEMPTS`
(3, máx. 5). Sólo se reintenta un fallo transitorio reconocido (timeout, ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN,
5xx); 401/403, formato inválido o contradicción no. La decisión usa un intento completo; los fallidos quedan
registrados. `audit-evidence/dependency-audit-report.json` (artifact `dependency-audit-evidence`, `if: always()`)
guarda herramienta/versión, commit y run de GitHub, SHA-256 del lockfile, ámbito, intentos y decisión.

## Qué NO cubre

- La instalación reproducible (`yarn install --frozen-lockfile`) ocurre en el mismo job; el reporte lleva el
  hash del lockfile, pero el wrapper no reinstala ni compara `node_modules`.
- No hay entrada que acepte un reporte previo o un fixture: sólo vale el proceso que lanza este script.
- Los otros repos de Atlas no se tocan aquí: cada uno usa su propio gestor y debe verificarse por separado.
- Una corrida en verde prueba «completa y sin high/critical según el registro en ese instante», no ausencia de CVE.
