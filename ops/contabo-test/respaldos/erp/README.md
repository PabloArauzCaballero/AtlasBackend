# Respaldo y failover del ERP de TEST (Contabo)

Nace del 2026-10-02: el ERP de TEST estuvo caído 4 h 40 min porque el despliegue 1197 de Coolify
dejó el contenedor nuevo en `created`, sin arrancar («removal of container … already in progress»:
el demonio Docker tardó más de 60 s en borrar el viejo). Nadie se enteró: Coolify no tenía ningún
canal de aviso activo.

## Qué hay

| Pieza | Dónde | Estado (2026-10-02 14:35 UTC) |
|---|---|---|
| Respaldo FE + API (`docker-compose.yml`) | `/opt/atlas/respaldo-erp/` | **levantado, healthy** (140 MB, ~0 % CPU) |
| Imágenes `atlas-erp-frontend:estable`, `atlas-erp-backend:estable` | Docker de Contabo | las que servían sanas (FE `45b0fb7`, API `877d4b5`) |
| Alias `erp-web` y `erp-api-principal` en los contenedores principales | red `coolify` | puestos a mano; fijos en PR FE #46 y BE #47 (entran en la próxima promoción a `test`) |
| Failover en Traefik (`atlas-erp-failover.yaml`) | `/data/coolify/proxy/dynamic/` | **ACTIVO** desde 14:40 UTC (lo aplicó Pablo): `:3010`, `atlas.erp.test.arauzsoftware.com`, sslip FE y API. Copias de las rutas previas en `/opt/atlas/respaldo-erp/copias/` |
| Guardián automático (sanar `created`, avisos Telegram) | — | **PENDIENTE de autorización** (bloqueado por el clasificador) |
| Builds en serie (`concurrent_builds=1`) y caché podada (−72 GB) | Coolify / Docker | hecho |

## Prueba real (2026-10-02 10:48, medida desde el propio servidor)

`docker stop` del frontend principal → 2 s de 502 → respaldo (`"version":"unknown"`) → **10 s de 502**
(Traefik recarga la config al desaparecer el contenedor y sus sondas arrancan dando la principal por
sana hasta la siguiente comprobación, que era a 10 s) → respaldo estable → `docker start` → vuelve
solo a la principal. Corrección en el fichero: sondas a 2 s y reintento (`retry`, 5 intentos) en las
rutas del portal, con rutas propias de prioridad 200 para `:3010` y el dominio. **Medir sondas desde
el servidor (`ssh -n`), nunca desde el Mac con un `ssh &` en segundo plano**: se queda parado
esperando stdin y la medida sale falsa (000 durante minutos con el servicio sano).

## Despliegue real con el failover corregido (2026-10-02 10:53–10:59)

Despliegue 1205 del ERP frontend (`45b0fb7` → `e8ef7b5`): **272 sondas a `:3010`, una por segundo
desde el servidor, cero respuestas ≠200**. El respaldo sirvió 26 s durante el cambio de contenedor
y la principal nueva entró sola, ya con su alias `erp-web` desde el compose (PR #46).
Antes: 12–36 s de corte por despliegue, y el 2026-10-02, 4 h 40 min.

## Activar el failover (Pablo, ~1 min) — HECHO 14:40 y corrección 14:55

Desde la terminal de Claude Code, con `!` delante:

```
scp _herramientas/respaldo-erp/atlas-erp-failover.yaml root@161.97.85.216:/data/coolify/proxy/dynamic/
```

Eso ya cubre `erp.161.97.85.216.sslip.io` y `erp-api.161.97.85.216.sslip.io` (routers con `priority: 100`).
Para que el `:3010` y `atlas.erp.test.arauzsoftware.com` también usen el failover, cambiar en el servidor
`service: http-0-boffxwlo9x4gmqhhvfno2mnx-frontend-aca3@docker` por `service: atlas-erp-web@file`:

```
ssh root@161.97.85.216 "sed -i 's/http-0-boffxwlo9x4gmqhhvfno2mnx-frontend-aca3@docker/atlas-erp-web@file/' /data/coolify/proxy/dynamic/atlas-por-ip.yaml /data/coolify/proxy/dynamic/atlas-dominios-propios.yaml"
```

Copias de los dos ficheros originales: en `/opt/atlas/respaldo-erp/copias/` (hacerlas antes:
`cp` de cada uno con sufijo `.antes-failover`). Deshacer: borrar `atlas-erp-failover.yaml` y
restaurar las copias. Traefik recarga solo (vigila el directorio).

**Probar:** `docker stop` del contenedor principal del FE → `curl http://161.97.85.216:3010/version`
sigue en 200 (sirve el respaldo, `"version":"unknown"`) en ≤10 s → `docker start` → vuelve al principal.

## Actualizar el respaldo tras un despliegue sano

```
# Coolify 4.4.2 etiqueta por uuid (`coolify.applicationUuid`); antes, por id (app 6 y app 3).
FE=$(docker ps -q --filter label=coolify.applicationUuid=boffxwlo9x4gmqhhvfno2mnx --filter label=com.docker.compose.service=frontend --filter status=running)
API=$(docker ps -q --filter label=coolify.applicationUuid=cpzbl0hojfjtzg2ym4tk4shr --filter label=com.docker.compose.service=api --filter status=running)
docker tag "$(docker inspect -f '{{.Image}}' $FE)" atlas-erp-frontend:estable
docker tag "$(docker inspect -f '{{.Image}}' $API)" atlas-erp-backend:estable
cd /opt/atlas/respaldo-erp && docker compose up -d
```

## Límites conocidos

- Si cae la API principal, el FRONTEND (que llama a `erp:3007`, horneado) no llega a la API hasta
  prestar el alias al respaldo (comando en el comentario de `docker-compose.yml`). La API pública sí
  hace failover sola.
- El respaldo no migra: si un despliegue cambia el esquema de forma incompatible, el respaldo viejo
  puede fallar contra la base nueva. Actualizarlo tras cada despliegue sano.
- Sin el guardián, un `created` como el del 2026-10-02 lo cubre el failover (sirve el respaldo),
  pero nadie arranca el principal ni avisa. Para eso: guardián + Telegram (pendiente).
