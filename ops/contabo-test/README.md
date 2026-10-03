# TEST en Contabo: guardián, respaldos, failover y monitor

Fuente versionada de lo que corre **fuera de Coolify** en el servidor de TEST (`161.97.85.216`). Hasta el
2026-10-03 vivía sólo en `/opt/atlas` y en una carpeta sin git: si se perdía el VPS, se perdía con él.

Por qué existe: entre el 2026-10-01 y el 2026-10-02 un despliegue dejó el ERP caído 4 h 40 min y los
tableros ~36 h, sin que nadie se enterara. Un despliegue de Coolify retira el contenedor viejo con
`docker rm` y, con el servidor cargado, el demonio no termina a tiempo: el nuevo queda en `created` sin
arrancar (`restart: unless-stopped` no actúa ahí).

## Qué hay

| Carpeta | Qué es | Dónde queda en el servidor |
|---|---|---|
| `guardian/` | Cada minuto: arranca contenedores que un despliegue dejó en `created`, avisa de apps caídas, presta el alias de una API a su respaldo mientras la principal no está sana y retaguea `:estable` | `/opt/atlas/guardian/` + `atlas-guardian-test.{service,timer}` |
| `monitor/` | Cada minuto: RAM, swap, carga, disco, caché de build, apps, respaldos, copia de bases; cada 5 min el resumen de AtlasBackend; alertas por Telegram al **cambiar** de estado; informe diario 08:00 y `/estado` a demanda; poda la caché de build | `/opt/atlas/monitor/` + `atlas-monitor.{service,timer}` |
| `respaldos/{erp,tableros,ligeros,apis}/` | Segunda instancia de cada app, con la última imagen que sirvió sana (`:estable`). Sin build, sin migrate, sin workers | `/opt/atlas/respaldo-*/` |
| `traefik/` | Failover principal → respaldo (sondas a 2 s). Traefik los vigila: entran al instante | `/data/coolify/proxy/dynamic/` |
| `lib/avisar.sh` | Función `avisar` común (journal + Telegram + correo firmado). Copia de referencia | `/opt/atlas/lib/` |

## Cobertura

ERP (web+API), tableros (web+API), portal admin, web del Motor, app web del cliente, mock de proveedores,
AtlasBackend API y Motor API. **No** se duplican workers, `migrate`, redis ni minio: un segundo consumidor
procesaría colas dos veces. `pdf-worker` y `ai-service` sólo tienen guardián y aviso.

## Instalar desde cero

Como root en el VPS, con este directorio copiado (por ejemplo `scp -r ops/contabo-test root@…:/root/`):

1. **Avisos.** `mkdir -p /opt/atlas/lib && install -m 644 lib/avisar.sh /opt/atlas/lib/` y crear
   `/opt/atlas/lib/avisar.env` (modo 600) con `TELEGRAM_TOKEN=` y `TELEGRAM_CHAT_ID=`. El bot se crea en
   @BotFather; el chat id sale de `getUpdates` tras escribirle al bot. **El token nunca se commitea ni se
   pega en el chat.** Si se filtra: `/revoke` en BotFather y repetir.
2. **Guardián.** `install -m 755 guardian/guardian.sh /opt/atlas/guardian/` (crear la carpeta),
   `install -m 644 guardian/*.service guardian/*.timer /etc/systemd/system/`,
   `systemctl daemon-reload && systemctl enable --now atlas-guardian-test.timer`.
3. **Respaldos.** Cada carpeta tiene su `docker-compose.yml`; `instalar.sh` (tableros, ligeros, apis) vuelca
   las variables de la principal, etiqueta `:estable` la imagen que corre hoy **si está sana**, y levanta el
   respaldo. El de ERP se instala según su `README.md`. Orden: ERP, tableros, ligeros, apis (uno a uno: el
   arranque de una API Nest pesa).
4. **Failover.** Copiar el `.yaml` de cada app a `/data/coolify/proxy/dynamic/`. Los ligeros y las APIs
   usan alias que declaran los `docker-compose.coolify.yml` de cada repo (`admin-web`, `motor-web`,
   `consumer-web`, `atlas-backend`, `motor`…): con el alias ausente la principal falla su sonda y sirve el
   respaldo (falla hacia lo seguro, pero con la versión anterior).
5. **Monitor.** `cd monitor && sh instalar.sh`. Para activar el resumen de AtlasBackend (red, tráfico,
   proveedores y negocio): `sh habilitar-monitor.sh` (crea `CONTEXT_SERVICE_TOKEN_SECRET` en Coolify para la
   app 1 y en `/opt/atlas/monitor/monitor.env`; entra en vigor en el siguiente despliegue de AtlasBackend).

## Qué avisa el monitor (sólo al cambiar de estado, con «RECUPERADO» al volver)

Host: RAM disponible < 2 GB · disco ≥ 85 % y ≥ 90 % · caché de build > 150 GB (la poda actúa sola, una vez
al día, con `docker builder prune --reserved-space 100GB`, nunca `-a`) · carga > 3×núcleos sostenida ·
contenedor de Atlas al > 90 % de su límite o reiniciándose.
Servicio: principal en marcha pero no sana · respaldo no sano · bloque de red DOWN · herramienta crítica
caída · 5xx > 2 % o p95 > 2 s en 15 min.
Negocio y datos: proveedor externo < 80 % de éxito · desenlaces agotados al Motor · cola de revisión con casos
de más de 24 h · outbox creciendo · copia de bases con más de 7 h.

Las reglas de semáforo del resumen viven en el módulo systems-ops del backend (archivo de reglas del monitor),
y copian las del portal admin para que Telegram y el portal digan lo mismo.

## Trampas medidas

- `avisar.sh` lee `AVISO_MAIL_*` sin protegerlas: con `set -u` mata el guion tras el primer aviso. Los guiones
  de aquí les dan valor vacío antes de cargarla.
- En Docker 29 `docker builder prune --keep-storage` ya no existe; es `--reserved-space`.
- `docker system df` y `docker stats` pesan con 100+ contenedores: el monitor los pide cada 30 y 5 min.
- Con el servidor cargado, Traefik tarda 2 s en notar que una principal cayó, y 2 s más en confiar en la que
  vuelve: las APIs (sin reintento, para no duplicar escrituras) tienen ese hueco; los portales lo tapan con
  `retry`.
- `Host(161.97.85.216)` con prioridad 200 se comería `/ai/` (`atlas-ai-por-ip.yaml`): la regla de la app web
  lo excluye.

## Verificación que se hizo (2026-10-03)

App web principal parada 21 s: 45/45 sondas 200. API de AtlasBackend parada 21 s: 41/45 (4 s de hueco). Un
despliegue real de AtlasBackend con migraciones: el guardián prestó `atlas-backend` al respaldo y lo devolvió
al quedar sana la nueva. Aviso y «RECUPERADO» reales al parar y arrancar un respaldo.
