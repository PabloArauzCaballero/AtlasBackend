---
name: code-quality-gates
description: Gate de calidad automatizado en CI y pre-commit — encadena formato, lint, typecheck, tests, cobertura, duplicación, complejidad y vulnerabilidades, con umbrales que bloquean el merge y una política de trinquete (ratchet) para que la calidad no se degrade con el tiempo. Usar al armar o endurecer el pipeline de un repo, al definir qué condiciones bloquean un PR, al agregar una métrica nueva al gate, o cuando la rama de integración se rompe seguido.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Gate de calidad — la calidad se verifica, no se pide

Un estándar sin gate automático es una sugerencia. Todo lo que "el equipo debería hacer"
que se pueda medir, se mide en CI y bloquea el merge. Lo que no bloquea, no se cumple.
Este gate es el ejecutor de `clean-code`, `solid-principles` y `code-review-standard`;
no repite sus reglas, las hace obligatorias.

## 1. Las etapas, en orden (barato → caro)

Ordená de más rápido a más lento: que el error trivial falle en 3 segundos, no en 8 minutos.

| # | Etapa | Herramienta típica | Bloquea si |
|---|---|---|---|
| 1 | Formato | Prettier `--check` | hay archivos sin formatear |
| 2 | Lint | ESLint + typescript-eslint | error de lint (no warning) |
| 3 | Typecheck | `tsc --noEmit` | cualquier error de tipo |
| 4 | Tests | Jest / Vitest | falla un test |
| 5 | Cobertura | reporter del runner | baja del umbral (ver §3) |
| 6 | Duplicación | jscpd | supera el umbral de copy-paste |
| 7 | Complejidad | eslint `complexity` / Sonar | hotspot sobre umbral (ver `code-complexity-metrics`) |
| 8 | Vulnerabilidades | `yarn npm audit`, Dependabot, SCA | vulnerabilidad alta/crítica |

Detalle de 1–2 en `static-analysis-linting`; 6 en `dead-code-duplication`; 8 en
`github-security-features` y `dependency-management`.

## 2. Dos puntos de control, no uno

- **Pre-commit / pre-push** (rápido, local): formato + lint + typecheck sobre lo *staged*
  (`lint-staged`). Es feedback, no la barrera final; se puede saltear con `--no-verify`.
- **CI (la barrera real):** corre TODO sobre todo el diff, no confía en el hook local.
  El merge lo bloquea un *required status check*, no la buena voluntad. Configurá los
  checks requeridos en `github-branch-protection-rulesets`; implementá el workflow en
  `github-actions-ci`.

Nunca dependas solo del hook local: es opcional por diseño.

## 3. Umbrales: absolutos vs "código nuevo"

El error clásico es exigir 80% global a un repo que está en 40%: nadie puede mergear y
el gate se termina desactivando. La estrategia que funciona es **"limpio a medida que
avanzás"** (clean-as-you-code de Sonar): el umbral duro aplica al **código nuevo/modificado**
del PR, no al repo entero.

- Código nuevo: cobertura ≥ el objetivo (definí el número en el CLAUDE.md del proyecto),
  cero issues nuevas de severidad alta, cero duplicación nueva.
- Código viejo: se mide y se muestra la tendencia, pero no bloquea salvo que lo toques.

## 4. Trinquete (ratchet): que solo pueda mejorar

Para métricas globales que no querés que empeoren nunca, guardá el valor actual como
piso y falla si el PR lo baja:

```bash
# ✅ el número solo puede subir; si baja, el gate falla y hay que actualizar el piso a conciencia
prev=$(cat .quality/coverage-floor)      # p.ej. 62.4
curr=$(node scripts/read-coverage.js)    # cobertura del build actual
awk -v c="$curr" -v p="$prev" 'BEGIN{ exit !(c + 0.01 >= p) }' \
  || { echo "Cobertura bajó de $prev a $curr"; exit 1; }
```

El piso se sube en un commit deliberado y revisado, nunca se baja "para que pase".

## 5. Política de rama verde

- La rama de integración **siempre** compila y pasa el gate. Un check rojo en `main`
  es un incidente, no un estado tolerado.
- `concurrency` en el workflow para cancelar corridas viejas del mismo PR y no gastar CI.
- Merge queue (ver `github-branch-protection-rulesets`) para que el orden de merge no
  rompa la rama por combinación de PRs verdes individualmente.
- Flaky detiene todo: un test que falla a veces se cuarentena con dueño y fecha
  (`regression-suite-management`), no se ignora el gate entero.

## 6. Anti-patrones

- `continue-on-error: true` en un paso que debería bloquear → el gate es decorativo.
- Umbral global inalcanzable → todos aprenden a saltearlo.
- Warnings que nadie mira: o son error y bloquean, o se borra la regla. El limbo de
  10 000 warnings no protege nada.
- Cobertura como único gate: 100% de líneas con aserciones vacías no prueba nada
  (ver `unit-testing`).
- Gate que corre solo en `main` post-merge: encontrás el problema cuando ya entró.

## Checklist
- [ ] Las 8 etapas corren en CI, ordenadas de barata a cara, y las que deben, bloquean.
- [ ] Los checks están marcados como *required* en la protección de rama.
- [ ] Umbral duro sobre código nuevo; tendencia visible sobre el viejo.
- [ ] Hay trinquete sobre las métricas globales que no deben empeorar.
- [ ] `concurrency` cancela corridas obsoletas; no hay `continue-on-error` indebido.
- [ ] Ningún paso relevante quedó como warning ignorado.

## Evidencia / DoD
Pegá la **salida literal**:
- El resumen del run de CI mostrando cada etapa y su resultado (verde/rojo).
- Para el PR: el número de cobertura/duplicación/issues del **código nuevo** vs el umbral.
- Si tocaste el piso del trinquete: el commit que lo cambió y por qué.
Sin esa salida pegada, el gate no está "configurado"; está "supuestamente configurado".
Ver `evidence-and-verification`.
