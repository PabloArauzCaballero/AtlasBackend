---
name: coolify-deployment
description: Despliegue en Coolify self-hosted — servers/projects/environments, elección de build pack (Nixpacks, Railpack, Static, Dockerfile, Compose) para API NestJS, Angular SSR y Astro, GitHub App vs deploy key, auto-deploy, previews por PR, dominios con TLS, puertos, healthchecks, variables build vs runtime, rolling updates y rollback. Usar al crear o reconfigurar un recurso en Coolify, al conectar un repo, o cuando el deploy queda verde pero el dominio no responde.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Despliegue en Coolify

Coolify cambia rápido: los nombres de menú y opciones de abajo están verificados contra la doc
oficial (coolify.io/docs) a la fecha de escritura. Si algo no coincide con tu instancia, mandá la
doc de tu versión. Operación diaria en `coolify-operations`; bases en `coolify-databases-backups`;
la imagen en `dockerfile-production`; el chequeo post-deploy en `deployment-verification-smoke`.

## 1. Modelo mental

| Concepto | Qué es |
|---|---|
| **Server** | Máquina con Docker donde corren los contenedores (puede ser la misma de Coolify u otra por SSH). |
| **Project** | Agrupador lógico (un producto). |
| **Environment** | Subdivisión del project: `production`, `staging`... Variables y recursos separados. |
| **Resource** | Application (desde Git o imagen), Database (Postgres, Redis...) o Service (plantilla). |
| **Destination** | Red Docker del server donde vive el recurso; recursos en la misma red se ven por nombre. |

Regla de la casa: **un environment por entorno real** (`production` ≠ `staging`), nunca el mismo
recurso apuntando a dos ramas "según el momento". Definí en el CLAUDE.md del proyecto qué server,
project y environment corresponde a cada app.

## 2. Elegir build pack

Coolify ofrece: **Nixpacks**, **Railpack** (beta), **Static**, **Dockerfile**, **Docker Compose**.
La doc lo resume así: Nixpacks/Railpack cuando la detección automática alcanza; Dockerfile o Compose
cuando el repo debe definir la imagen o la topología explícitamente.

| App | Build pack | Motivo |
|---|---|---|
| API NestJS (yarn 4, ESM) | **Dockerfile** | Control de Corepack, prod-only deps, usuario no root, `HEALTHCHECK`. Nixpacks funciona pero adivina. |
| Angular SSR | **Dockerfile** | Es un **proceso Node** (`node dist/<app>/server/server.mjs`), no un sitio estático. Static pack lo rompería. |
| Landing Astro (output estático) | **Static** (o Nixpacks) | Sin server; publish directory = salida del build (`dist/` por defecto en Astro). Si usás adapter SSR, tratala como Node. |
| API + worker + cola | **Docker Compose** | Varios servicios con una topología declarada. |

Nixpacks: si necesitás fijar versión de Node, `nixpacks.toml` con `[phases.setup] nixpkgsArchive = '<sha>'`.
Static: marcá SPA solo si la app enruta en cliente; Angular SSR **no** es SPA estática.

## 3. Conectar el repo (GitHub)

| Método | Cuándo |
|---|---|
| **GitHub App** (recomendado) | Repos privados de la organización. Webhooks automáticos, previews por PR, estado de commit, sin claves SSH. La instalación de la App controla qué repos ve Coolify. |
| **Deploy key** | Un repo privado suelto o una org donde no podés instalar apps. Requiere webhook manual (`Configuration > Webhooks`, secreto largo, evento *push* y *pull_request* si hay previews). |
| **GitHub Actions + imagen** | Construís y publicás en GHCR desde Actions y Coolify solo despliega la imagen. Ver `github-actions-ci`. |

Auto-deploy por push está habilitado por defecto (`is_auto_deploy_enabled`). **Watch paths**: en
monorepos, limitá qué rutas disparan el deploy para no reconstruir todo por un README.

## 4. Preview deployments (PR)

- Requieren **DNS wildcard** (`*.preview.ejemplo.com`) apuntando al server.
- Plantilla de dominio con `{{pr_id}}` y/o `{{random}}`.
- Variables separadas: **Production Environment Variables** no se pasan a previews; usá
  **Preview Deployment Environment Variables**. Nunca credenciales de producción en un preview.
- **Allow Public PR Deployments**: dejalo apagado (ejecuta código de terceros en tu server).
- Coolify borra el preview al cerrar/mergear el PR.
- Un preview con base compartida de staging puede pisar datos: base propia o datos desechables.

## 5. Dominios, TLS y puertos

- Dominio con esquema: `https://api.ejemplo.com`. Con `https://`, Coolify emite y renueva
  Let's Encrypt automáticamente vía el proxy (Traefik por defecto). DNS A/AAAA al server ANTES.
- Varios dominios separados por coma; redirección `www`/`non-www` configurable.
- **Ports Exposes** = puerto interno donde ESCUCHA el proceso (lo usa el proxy y el healthcheck).
  **Ports Mappings** = publicar en el host (`host:container`) — evitá: saltea el proxy y expone.
- El proceso debe escuchar en `0.0.0.0`, no en `localhost`. Coolify inyecta `HOST=0.0.0.0` y
  `PORT` (primer puerto expuesto) si no están definidos.
- Un dominio en dos recursos = conflicto; Coolify avisa salvo `force_domain_override`.

## 6. Variables de entorno

- Cada variable tiene dos flags independientes: **Build Variable** y **Runtime Variable** (ambos
  activos por defecto). Secretos que solo se leen al arrancar: **desactivá Build Variable**.
- Los build args tradicionales quedan en la metadata de la imagen. Para secretos en build usá
  **Use Docker Build Secrets** (necesita BuildKit; sin él, Coolify cae a build args).
- Predefinidas: `COOLIFY_FQDN`, `COOLIFY_URL`, `COOLIFY_BRANCH`, `COOLIFY_RESOURCE_UUID`,
  `COOLIFY_CONTAINER_NAME`, `SOURCE_COMMIT`, `PORT`, `HOST`. `SOURCE_COMMIT` se excluye del build
  por defecto (caché); activá **Include Source Commit in Build** si la app muestra su versión.
- Variables compartidas a nivel team/project/environment para no duplicar.
- Nunca pegues un `.env` completo con secretos de producción en un chat, issue o PR.

## 7. Healthcheck y deploy sin downtime

- `Configuration > Healthcheck`: tipo HTTP (método, esquema, host `localhost`, puerto interno,
  path como `/health`) o CMD; Interval, Timeout, Retries, Start Period.
- **La imagen final debe tener `curl` o `wget`**; si no, el check HTTP falla y Docker marca
  el contenedor unhealthy. Para apps Dockerfile, si la imagen trae `HEALTHCHECK`, Coolify lo usa
  en vez del configurado en el panel.
- Traefik saca de la ruta a los contenedores unhealthy: si todos lo están, ves `404` o
  `No available server`.
- **Rolling update**: Coolify arranca el contenedor nuevo sin parar el viejo, espera que el
  healthcheck pase, conserva el viejo si el nuevo queda unhealthy, y recién después retira el viejo.
  Sin healthcheck, "arrancó" = "listo", y podés servir errores durante el arranque.
- Prerequisitos reales: el endpoint de salud falla durante el arranque y pasa solo cuando puede
  servir; la app maneja la señal de terminación y termina requests dentro del
  **Stop Grace Period**; el cambio es compatible hacia atrás (dos versiones conviven segundos).
- No se garantiza zero-downtime para apps con **Ports Mappings** al host ni para bases.

## 8. Rollback

`Configuration > Rollback` → elegí la imagen del deploy anterior → seguí la operación en
**Deployments** → verificá dominio, logs, healthcheck y flujo crítico. El rollback usa la
configuración ACTUAL (variables, mounts) con la imagen vieja: si cambiaste una variable después
de esa imagen, revisala antes. Un cambio de esquema de base **no se deshace con el rollback de la
app**: ver `release-and-rollback`.

## 9. Anti-patrones

- Static pack para Angular SSR; Ports Mappings "para probar"; base expuesta a internet.
- Producción y staging en el mismo environment cambiando la rama a mano.
- Secretos como build args; `.env` de producción copiado a previews.
- Deploy sin healthcheck y llamarlo "zero downtime".
- Rebuild con `force` como reflejo ante cualquier fallo sin leer el log.

## Checklist

- [ ] Server/project/environment correctos; staging ≠ production.
- [ ] Build pack elegido por tabla; Angular SSR como proceso Node.
- [ ] GitHub App instalada solo en los repos necesarios; auto-deploy y watch paths definidos.
- [ ] Dominio con `https://`, DNS apuntando antes del primer deploy, sin Ports Mappings.
- [ ] Proceso escucha en `0.0.0.0:$PORT`; Ports Exposes coincide.
- [ ] Variables con flags build/runtime correctos; secretos de build via Build Secrets.
- [ ] Healthcheck configurado y `curl`/`wget` presente en la imagen.
- [ ] Rolling update probado bajo tráfico; Stop Grace Period acorde.
- [ ] Previews con variables propias y sin PR públicos.
- [ ] Post-deploy verificado con `deployment-verification-smoke`.
