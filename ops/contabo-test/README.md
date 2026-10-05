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
| `monitor/` | Cada minuto: RAM, swap, carga, disco, caché de build, apps, respaldos, copia de bases; cada 5 min el resumen de AtlasBackend; alertas por Telegram al **cambiar** de estado; informe diario 08:00 y comandos del bot (ver abajo); poda la caché de build | `/opt/atlas/monitor/` + `atlas-monitor.{service,timer}` |
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

## Comandos del bot

Sólo atiende al chat de Pablo (`TELEGRAM_CHAT_ID`); lo que llegue de otros chats se ignora sin contestar. Todos
son de lectura, salvo `/silenciar` y `/podar`. No hay `/reiniciar` ni `/desplegar` a propósito: si alguien
consiguiera escribir al bot, no debería poder tocar el servidor. El monitor lee los mensajes una vez por
minuto, así que la respuesta tarda hasta un minuto.

| Comando | Qué responde |
|---|---|
| `/status` (`/estado`, `/ram`, `/grafico`) | Informe del servidor y de las apps, con el gráfico PNG de 24 h de RAM libre, disco y carga |
| `/apps` | Cada app: principal, respaldo, memoria y reinicios |
| `/alertas` | Qué está en rojo ahora y desde cuándo (y si los avisos están silenciados) |
| `/despliegues` | Últimos 8 despliegues de Coolify (app, commit, estado, duración) y la cola |
| `/negocio`, `/trafico`, `/proveedores` | Del resumen de AtlasBackend; sin el secreto de servicio contestan que no está habilitado |
| `/ssh` | La puerta SSH en 24 h: intentos fallidos, los que más insisten, fail2ban, quién entró (marcando IPs no conocidas y entradas con contraseña) y la configuración efectiva |
| `/copias` | Última copia de las bases: antigüedad, peso y filas por base |
| `/silenciar 1h` | Calla los avisos hasta 6 h; `/silenciar off` los reactiva. Los cambios de estado se siguen registrando |
| `/podar` → `/podar confirmar` | Poda la caché de build; la confirmación caduca a los 2 min y corre en una unidad systemd aparte |

## Vigilancia de la puerta SSH

`monitor/ssh.sh` sólo lee (journal de sshd, fail2ban, `authorized_keys`); no cambia ninguna configuración de SSH.
El ruido de fuerza bruta es constante (≈6.400 intentos al día, 1.800 contra root el 2026-10-04) y fail2ban lo
contiene, así que no se avisa por él. Se avisa de lo que no es ruido, y esos avisos **no los calla `/silenciar`**:

- Entrada exitosa desde una IP que no está en `/opt/atlas/monitor/ssh-conocidas.txt` (una vez por IP).
- Entrada con contraseña (una vez por IP y día) y entrada desde una IP que había fallado ≥5 veces en la última hora.
- Pico de ≥150 intentos fallidos en 5 min (lo normal son ~20) y fail2ban parado.
- Cambio de `authorized_keys` o de la configuración efectiva de sshd (la primera pasada fija la referencia).

`ssh-conocidas.txt` se sembró con las IPs que entraron ≥10 veces en 14 días: revisarla con `/ssh`.

### Endurecer SSH (acción de una persona)

`monitor/endurecer-ssh.sh` pone `PermitRootLogin prohibit-password`, `PasswordAuthentication no` y
`LoginGraceTime 30` en `/etc/ssh/sshd_config.d/00-atlas-hardening.conf`. Se llama `00-` porque en sshd gana el
primer valor y `50-cloud-init.conf` fija `PasswordAuthentication yes`. No se aplica si la sesión no entró con
llave; hace copia de `/etc/ssh`, prueba con `sshd -t`, recarga sin cortar sesiones y **se revierte solo a los
10 min** salvo `sh endurecer-ssh.sh confirmar` tras entrar desde otra terminal. No baja `MaxAuthTries`: con varias
llaves en el agente dejaría fuera a quien entra bien. Sin cambios en el cortafuegos (`ufw` sigue inactivo): en un
servidor compartido se hace con el dueño de cada puerto.

### Limpieza de imágenes de Docker

Además de la caché de build, el monitor borra las imágenes **sin nombre ni etiqueta y de más de 24 h**
(`docker image prune -f --filter until=24h`, nunca `-a`): una vez por semana, o una vez al día si el disco está al
85 % o más. Las `:estable` de los respaldos y las de cada despliegue llevan nombre y no se tocan; las intermedias de
un build en curso son más recientes que 24 h. Avisa por Telegram cuánto liberó. El 2026-10-04 había 14 candidatas
(~4,7 GB); otros ~15 GB de imágenes con nombre pero sin uso son de otros proyectos del servidor y no se borran solos.

## Qué avisa el monitor (sólo al cambiar de estado, con «RECUPERADO» al volver)

Host: RAM disponible < 2 GB · disco ≥ 85 % y ≥ 90 % · caché de build > 150 GB (la poda actúa sola, como mucho cada
6 h, y sin esperar si el disco llega al 88 %, con `docker builder prune --reserved-space 100GB`, nunca `-a`) · carga > 3×núcleos sostenida ·
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
- El emisor JWT de TEST vale literalmente `Falta JWT_ISSUER` (con espacio, así está en Coolify): en `monitor.env` va entre
  comillas, y sin ellas `. monitor.env` rompe esa línea y el monitor firma con el emisor por defecto → 401 `SERVICE_TOKEN_INVALID`.
- Coolify registra solo, VACÍAS y con marca de build, las variables que el compose referencia con `${X:-}`: «existe» no
  significa «tiene valor».
- `Host(161.97.85.216)` con prioridad 200 se comería `/ai/` (`atlas-ai-por-ip.yaml`): la regla de la app web
  lo excluye.

## Verificación que se hizo (2026-10-03)

App web principal parada 21 s: 45/45 sondas 200. API de AtlasBackend parada 21 s: 41/45 (4 s de hueco). Un
despliegue real de AtlasBackend con migraciones: el guardián prestó `atlas-backend` al respaldo y lo devolvió
al quedar sana la nueva. Aviso y «RECUPERADO» reales al parar y arrancar un respaldo.

## Llevarlo a producción

Todo esto nació de las caídas de TEST del 2026-10-01/02; producción no debería descubrir el modo de fallo en caliente.
Lo que hay que replicar y lo que hay que decidir antes de salir:

- **Replicar:** guardián, respaldo por app con `:estable`, failover de Traefik (reintento sólo en portales, nunca en
  APIs), alias estables en los compose, monitor con bot de Telegram, y la prueba de failover (parar la principal ~20 s
  midiendo cada segundo desde el servidor).
- **Un respaldo de API no es la API:** hay que apagar lo que la principal corre por dentro (`APP_ROLE=api`,
  `RUNTIME_JOBS_*`, `IDENTITY_RECONCILE_DISABLED=true`, outbox y barridos del Motor, el cron de tableros) y unirlo a la
  red del proyecto (los Redis sólo viven ahí).
- **Host propio** (en TEST el cuello fue la CPU y la caché de build compartidas con otros proyectos, no la RAM).
- **SSH endurecido desde el día 1** (`endurecer-ssh.sh`, `fail2ban`, cortafuegos) y vigilado (`ssh.sh`).
- **Secreto de servicio propio de producción** (`CONTEXT_SERVICE_TOKEN_SECRET`; nunca el de TEST). También enciende el
  directorio de destinatarios entre contextos.
- **Copias de las bases fuera del host** y simulacro de restauración: `respaldar.sh` copia a disco local y no sobrevive
  a perder el VPS.
- **Bot de Telegram distinto** al de TEST y un segundo canal (correo).

La versión larga, con las trampas medidas, está en la memoria del proyecto (`atlas-prod-resiliencia-y-monitoreo`).

