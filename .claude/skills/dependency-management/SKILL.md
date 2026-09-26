---
name: dependency-management
description: Gestión de dependencias de terceros bajo control — lockfile commiteado y builds reproducibles, política de actualización, auditoría de vulnerabilidades, fijar versiones, evaluar una dependencia antes de agregarla (tamaño, mantenimiento, licencia, superficie), workspaces de monorepo, dedupe y no romper con un upgrade. Usar antes de agregar cualquier dependencia nueva, al actualizar versiones, ante una alerta de vulnerabilidad, al configurar workspaces, o cuando un build falla "solo en CI" o "solo en mi máquina".
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Gestión de dependencias

Cada dependencia es código ajeno que corre con tus privilegios y toca datos de pacientes. Es
superficie de ataque, peso, y una promesa de mantenimiento futuro. Agregala con criterio y
mantenela bajo control.

## 1. Builds reproducibles: el lockfile manda

- El **lockfile** (`yarn.lock`, `package-lock.json`, `pubspec.lock`, `poetry.lock`) se commitea
  SIEMPRE. Es lo que garantiza que todos —y CI, y producción— instalan exactamente lo mismo.
- En CI e imágenes de producción, instalá desde el lockfile sin resolver: `yarn install
  --immutable` (yarn 4) / `npm ci` / `pip install -r requirements.txt` con hashes. Nunca un
  install que pueda mover versiones en el pipeline.
- "Anda en mi máquina pero no en CI" casi siempre es un lockfile desactualizado o un install que
  resolvió distinto. Regenerá el lock y commitealo.

## 2. Antes de agregar una dependencia

Preguntate, en orden:
1. ¿Lo necesito de verdad, o son 20 líneas que puedo escribir y testear? (una dep trivial es
   deuda y riesgo de supply chain; ver `security-guardrails`).
2. ¿Está mantenida? Último release, issues abiertos, un solo mantenedor, ¿responde?
3. ¿Cuánto pesa y qué arrastra? Mirá el árbol transitivo, no solo el paquete.
4. ¿Qué licencia tiene y es compatible con el producto? (registralo, ver `seed-data-catalogs`
   para el criterio de procedencia/licencia).
5. ¿Qué permisos/superficie agrega? Una dep que hace red o toca el FS amplía tu riesgo.

Si entra, entra fijada y con una línea en el PR justificando por qué (`code-review-standard`).

## 3. Fijar versiones

- Aplicaciones: fijá versiones exactas o rangos estrechos y confiá en el lockfile para lo
  transitivo. Evitá rangos amplios (`^`, `*`) que dejan entrar cambios no revisados.
- Librerías que publicás: rangos compatibles con SemVer para no forzar conflictos aguas abajo.
- Acciones de CI y de terceros: fijalas por SHA, no por tag móvil (`github-actions-ci`,
  `github-security-features`).

## 4. Actualizar sin romper

- Actualizá **seguido y de a poco**, no todo junto una vez al año (esos upgrades masivos rompen y
  nadie sabe qué línea fue).
- Automatizá las PRs de actualización (Dependabot / Renovate) y revisalas como cualquier PR:
  con CI en verde (`code-quality-gates`).
- Un upgrade **major** es un cambio de contrato: leé el changelog, esperá breaking changes, corré
  la suite completa y probá el flujo real. Un major nunca se mergea a ciegas.
- Separá el PR de actualización de dependencias de los PRs de feature: si algo se rompe, querés
  saber que fue el upgrade (`refactoring-safely`, mismo principio).

## 5. Auditoría de vulnerabilidades

- Corré la auditoría en CI: `yarn npm audit` / `npm audit` / `pip-audit`, y Dependabot alerts +
  dependency review en los PRs (`github-security-features`).
- Triage por severidad y **explotabilidad real** en tu contexto, no por el número solo: una vuln
  en una dep de build de dev no es lo mismo que en una que sirve requests con datos sensibles.
- No silencies una alerta sin registrar por qué (falso positivo / no alcanzable / mitigada). Un
  `audit` en verde forzado a mano no es seguridad.

## 6. Monorepo y workspaces

- En workspaces (yarn/npm), fijá versiones compartidas en la raíz y evitá que dos paquetes usen
  versiones distintas de la misma dep (dedupe). La divergencia causa bugs sutiles y bundles dobles.
- Las dependencias internas entre repos hermanos se versionan y coordinan como cualquier release
  (`github-multirepo-coordination`, `github-releases-versioning`).

## Anti-patrones

- Lockfile en `.gitignore` o desactualizado respecto de `package.json`.
- `install` que resuelve versiones dentro del pipeline de CI o al construir la imagen.
- Agregar una dep pesada para usar una función; o una dep trivial de un solo mantenedor sin mirar.
- Upgrade major mergeado sin leer el changelog ni correr la suite.
- Silenciar una alerta de vulnerabilidad sin dejar constancia.
- `^` en todo y rezar.

## Checklist

- [ ] El lockfile está commiteado y coincide con el manifiesto.
- [ ] CI e imagen instalan desde el lock sin resolver (`--immutable`/`ci`).
- [ ] La dep nueva la justifiqué: necesaria, mantenida, peso/árbol y licencia mirados.
- [ ] Versiones fijadas según el caso (app estrecha / lib SemVer / actions por SHA).
- [ ] La auditoría de vulnerabilidades corre en CI y triagé lo que apareció.
- [ ] Los majors se leyeron y probaron; el PR de deps va separado de features.
- [ ] En monorepo, sin versiones divergentes de la misma dep.

## Evidencia / DoD

Antes de mergear un cambio de dependencias, pegá: la salida de la auditoría (`audit`) con su
triage, el estado de CI en verde instalando desde el lockfile, y —si fue un major— la corrida de
la suite completa. Un cambio de deps sin auditoría ni suite verde es `WRITTEN`, no verificado
(`evidence-and-verification`).
