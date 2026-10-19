# Redis en bucle de reinicios por AOF dañado

**Síntoma:** el bot de TEST manda decenas de `REINICIO: atlas-redis-… se reinició N vez/veces`, y detrás
`HERRAMIENTA CRÍTICA caída: Nest Throttler Redis Storage, Redis`, `atlas-backend … NO sano`, 5xx > 2 % y
`El resumen de monitoreo de AtlasBackend NO responde (HTTP 503)`. El contenedor `atlas-redis-*` queda en
`Restarting (1)`.

**Causa (2026-10-19):** el archivo de solo-añadir (`appendonlydir/appendonly.aof.N.incr.aof`) quedó con una
cola dañada (61 bytes) tras un corte a mitad de escritura. Redis lo lee, no lo entiende y sale con 1:

```
# Bad file format reading the append only file appendonly.aof.4.incr.aof: make a backup of your AOF file,
  then use ./redis-check-aof --fix <filename.manifest>
```

`restart: unless-stopped` lo relanza cada minuto, así que el bucle no acaba solo. Mientras dura, el limitador
de tasa (Throttler) y la revocación de tokens no tienen almacén, la API se marca `unhealthy` y el guardián
presta `atlas-backend` a su respaldo.

## Prevención (ya en los compose)

`docker-compose.coolify.yml` y `docker-compose.dev.yml` arrancan Redis con un guion que, **antes** de
`redis-server`, comprueba el AOF con `redis-check-aof`:

1. Sano: arranca normal.
2. Dañado: lo copia a `/data/aof-danado-<fecha>`, lo repara con `redis-check-aof --fix` y arranca.
3. Irreparable: aparta `appendonlydir` entero (la copia ya está hecha) y arranca limpio.

El log del contenedor dice `AOF DANADO: copia en …` cuando actúa. Lo que se pierde es la cola dañada: contadores
de límite de tasa y, como mucho, marcas de revocación de tokens recientes (los tokens caducan solos). Una prueba
(`test/unit/config/redis-arranque-autocurable.spec.ts`) falla si alguien vuelve a un `redis-server --appendonly yes`
a secas.

## Si aun así pasa (reparación manual)

El nombre del contenedor **cambia en cada despliegue** (`…-20261018T075739` → `…-20261019T120924`): no lo
copies de un aviso, búscalo por prefijo.

```sh
ssh root@161.97.85.216
N=$(docker ps -a --filter name=atlas-redis-bhhuqeuq5lchwcwbg7fxpy75 --format '{{.Names}}' | head -1)
V=/var/lib/docker/volumes/bhhuqeuq5lchwcwbg7fxpy75_redis-data/_data
docker logs --tail 5 $N                       # confirma «Bad file format»
docker stop $N
cp -a $V /root/redis-data-backup-$(date +%Y%m%d-%H%M%S)
docker run --rm -v bhhuqeuq5lchwcwbg7fxpy75_redis-data:/data redis:7-alpine \
  sh -c 'cd /data/appendonlydir && yes | redis-check-aof --fix appendonly.aof.manifest'
docker start $N
```

Verifica por el CUERPO, no por el código: `docker ps --filter name=atlas-redis` en `Up … (healthy)`,
`docker logs $N` sin `Bad file format`, y `/api/v1/health` con `"service":"atlas-backend"` y `"database":"ok"`.
El respaldo (`atlas-backend-respaldo`) vuelve a `healthy` solo.

## Trampas medidas

- **El volumen `bhhuqeuq5lchwcwbg7fxpy75_atlas-redis-data` es otro**, de un Redis viejo, y no es el que usa el
  contenedor. Mira `docker inspect … .Mounts` antes de tocar nada.
- **El AOF pesaba 48 MB para 13 claves:** el Throttler escribe sin parar y la reescritura automática sólo
  empieza a 64 MB. No es la causa, pero hace que la ventana de corrupción sea mayor.
- **Cada reinicio dispara un aviso nuevo con el contador acumulado:** un solo Redis caído generó ~200 mensajes.
  Si vuelve a ocurrir, el aviso útil es el primero; el resto es ruido hasta que el contenedor vuelva a `healthy`.
- **«Desplegado» no basta:** un redeploy de Coolify con el volumen dañado vuelve a levantar el bucle. Hay que
  reparar el volumen (o confiar en el arranque autocurable), no sólo redesplegar.

## Alcance

Sólo el Redis de este repo (`atlas-redis`, `redis` en dev). Los Redis del Motor, ERP y tableros no usan AOF
(`--appendonly no` o sin persistencia) y no tienen este modo de fallo.
