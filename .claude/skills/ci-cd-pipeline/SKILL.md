---
name: ci-cd-pipeline
description: Diseño de un pipeline de CI/CD agnóstico de plataforma — etapas (instalar → lint → typecheck → test → build → escaneos → desplegar), fail-fast, cacheo, artefactos, quality y security gates que bloquean el merge, promoción entre entornos y desplegar solo desde verde. Usar al diseñar el pipeline de un repo o servicio nuevo, al ordenar o acelerar las etapas, o al decidir qué bloquea un merge y qué un deploy. La implementación en GitHub va en `github-actions-ci`.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Pipeline de CI/CD

El pipeline es el guardián entre "lo escribí" y "está en producción". Esta skill define **qué**
etapas hay, en qué orden y qué bloquea; el **cómo** en GitHub (sintaxis, cachés, permisos,
OIDC, servicios) vive en `github-actions-ci`, y el corte de versión en
`github-releases-versioning`.

## 1. Dos mitades

- **CI (integración)**: en cada push/PR, prueba que el cambio es sano. No despliega nada.
- **CD (entrega/despliegue)**: cuando CI está verde en la rama correcta, promueve el artefacto a
  un entorno. Continuous **delivery** = listo para desplegar con un click; continuous
  **deployment** = se despliega solo. Elegí según el riesgo del producto (una plataforma de salud
  suele querer un gate humano hacia producción).

## 2. Etapas de CI, en orden (barato y frecuente primero)

```
instalar deps (con caché)
      ↓
formato + lint  ─┐
typecheck        ├─ pueden ir en paralelo: fallan rápido y no dependen entre sí
unit tests       ─┘
      ↓
build (compila / empaqueta)
      ↓
integración + contrato (necesitan base/servicios reales)
      ↓
e2e (sobre el build real)
      ↓
escaneos: SCA (deps), secret scan, SAST, y del artefacto/imagen
```

- **Fail-fast**: lo más rápido y más probable de fallar, primero. No corras un e2e de 8 minutos
  si el lint ya está roto.
- **Paralelizá lo independiente** (lint, typecheck, unit) para bajar el tiempo total.
- **Cacheá** dependencias y resultados de build entre corridas; invalidá por hash del lockfile.
- El pipeline es **determinista y reproducible**: instalá desde el lockfile (install "limpio"),
  no resuelvas versiones nuevas en CI. Congelá también las versiones de las acciones/imágenes.

## 3. Quality gates — qué bloquea el merge

Un gate es un chequeo que **impide avanzar** si no pasa. En el merge:

- Lint sin errores, typecheck limpio, tests verdes.
- Cobertura y duplicación/complejidad dentro del umbral, sin degradar respecto de la base
  (ver `code-quality-gates`).
- Sin vulnerabilidades por encima del umbral acordado y sin secretos detectados
  (ver `security-testing`, `github-security-features`).
- Para APIs: sin cambios incompatibles de contrato no versionados (ver `api-openapi-docs`).

Estos gates se hacen **obligatorios** en la protección de rama para que no se puedan saltear
(ver `github-branch-protection-rulesets`). Un gate que se puede ignorar no es un gate.

## 4. Artefactos: construir una vez, promover el mismo

- **Compilá/empaquetá una sola vez** y promoví **ese mismo artefacto** (imagen con un tag
  inmutable, p. ej. el SHA del commit) por dev → staging → prod. Reconstruir por entorno permite
  que se cuele una diferencia entre lo probado y lo desplegado.
- Guardá artefactos de diagnóstico aunque el job falle: traces y capturas de Playwright,
  reportes de cobertura, logs de build.

## 5. CD: promoción entre entornos

```
merge a la rama de integración → deploy automático a staging → verificación → deploy a prod (gate)
```

- **Desplegar solo desde verde**: nunca desde una rama con CI roja.
- **staging antes que prod**, con datos que no sean de producción (nunca datos personales reales; ver
  `data-privacy-sensitive`).
- Cambios de esquema/datos aplicados en el deploy con **compatibilidad hacia atrás** (expand →
  migrar → contract), de modo que la versión vieja y la nueva convivan durante el rollout
  (ver `model-driven-schema`, `release-and-rollback`).
- **Verificación post-deploy** obligatoria: healthcheck + smoke de los flujos críticos contra la
  URL real, con criterio de rollback si falla (ver `deployment-verification-smoke`).
- El deploy a producción de un producto sensible pasa por **aprobación humana** (environment con
  reviewers).

## 6. Multi-repo

Cuando un cambio cruza varios repos (API, web, mobile, modelo), el orden de despliegue lo manda
la dependencia de contrato: primero lo que provee, después lo que consume, con la ventana de
compatibilidad abierta. Coordinación en `github-multirepo-coordination` (implementación) y
`git-workflow-multirepo` (git).

## Checklist

- [ ] Etapas ordenadas barato→caro, con fail-fast y lo independiente en paralelo.
- [ ] Install desde lockfile, versiones de acciones/imágenes fijadas, deps cacheadas.
- [ ] Gates de calidad y seguridad obligatorios en la rama, imposibles de saltear.
- [ ] Un solo artefacto construido y promovido por todos los entornos.
- [ ] Deploy solo desde verde; staging antes que prod; prod con aprobación humana.
- [ ] Cambios de datos compatibles hacia atrás; verificación post-deploy con rollback definido.
