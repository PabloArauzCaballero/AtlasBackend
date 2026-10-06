# Plan de producción de Atlas · réplica exacta del entorno actual

Fecha: 2026-10-06 · Fuente: inventario en vivo de Contabo (`161.97.85.216`) y del H310 (`100.101.207.88`),
solo lectura, más las fuentes de `_herramientas/` y la memoria del proyecto.
**Este documento no contiene secretos.** Donde hace falta uno, dice dónde vive y cómo se crea el de producción.

> Convención: **[MEDIDO]** = visto en el servidor hoy. **[REPO]** = sale de un archivo versionado.
> **[DECIDE PABLO]** = decisión abierta que no se puede resolver desde código.

---

## 0. Qué se replica y qué NO

Hoy hay tres entornos:

| Entorno | Dónde                                           | Ramas              | Papel                                            |
| ------- | ----------------------------------------------- | ------------------ | ------------------------------------------------ |
| DEV     | H310 (Tailscale `pablo-h310.taila8f993.ts.net`) | `dev`              | desarrollo; Coolify propio                       |
| TEST    | VPS Contabo `vmi3544825` (`161.97.85.216`)      | `test`             | pruebas de Pablo; **es el modelo de producción** |
| PROD    | no existe                                       | `main` (a definir) | lo que este plan crea                            |

**Se replica de TEST:** la forma (Coolify + Traefik + Postgres propio + guardián + respaldos + monitor + Telegram + SSH
endurecido). **No se replica:** los problemas de TEST. El host de TEST es **compartido con otros proyectos** (aportaya,
SCM, CPA, GymSheet, datacenter, observatorio, whatsapp-gateway: ~30 apps de Coolify, de las cuales 14 son de Atlas)
y eso fue la causa de fondo de las caídas (carga 18–43, caché de build de 150–185 GB). **PROD va en host propio.**

## 1. Servidor: la especificación exacta

[MEDIDO, Contabo hoy] — la memoria decía 8 CPU / 23 GiB; el host real ya es otro:

| Recurso   | TEST hoy                                                                                             | PROD (mínimo para Atlas solo)                                                               |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SO        | Ubuntu 24.04.4 LTS, kernel 6.8.0-142                                                                 | igual                                                                                       |
| CPU / RAM | 12 vCPU / 47 GiB (25 GiB en uso)                                                                     | 8 vCPU / 24 GiB sobran para las 14 apps de Atlas + respaldos; **el cuello fue CPU, no RAM** |
| Disco     | 400 GB (`sda1` 299 GB, 230 GB usados, 80 %)                                                          | ≥ 300 GB NVMe; la caché de build crece ~10 GB/h                                             |
| Swap      | `/swapfile` 4 GB, `vm.swappiness=10`                                                                 | igual                                                                                       |
| Docker    | 29.7.2, Compose v5.5.0, overlayfs, cgroup v2/systemd                                                 | misma versión fijada                                                                        |
| Coolify   | 4.3.23 (+ `coolify-db` pg15, `coolify-redis` 7, `coolify-realtime` 1.0.19, `coolify-sentinel` 1.0.1) | misma versión                                                                               |
| Proxy     | `traefik:v3.6` gestionado por Coolify                                                                | igual                                                                                       |
| Red       | `ufw` **inactivo** (error de TEST)                                                                   | **ufw activo** (§8)                                                                         |

Ajustes del sistema [MEDIDO]:

- `/etc/docker/daemon.json`: `log-driver json-file`, `max-size 10m`, `max-file 3`, `default-address-pools 10.0.0.0/8 /24`.
- `/etc/sysctl.d/*atlas*`: `fs.inotify.max_user_instances=1024`; `vm.max_map_count=1048576`; `vm.swappiness=10`.
- `/etc/cron.d/staticroute`: `@reboot ip route replace … via <gateway> dev eth0` (ruta estática del proveedor Contabo).
  Verificar si el proveedor de PROD la necesita; no copiar a ciegas.
- Coolify: `concurrent_builds=1`, `dynamic_timeout=3600`, `deployment_queue_limit=25` [MEDIDO].
- `fail2ban` activo [MEDIDO].

## 2. Inventario de aplicaciones de Atlas en Coolify [MEDIDO]

Todas con rama `test` hoy → `main` (o `prod`) en PROD. Compose = `/docker-compose.coolify.yml` salvo indicación.

| App                                   | Repo                        | Build                                    | Notas                                                                     |
| ------------------------------------- | --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| atlas-backend                         | AtlasBackend                | compose                                  | API + worker + `messaging-worker` + `migrate` + redis + MinIO             |
| atlas-erp-backend                     | AtlasERPBackend             | compose                                  | `migrate` en cada despliegue                                              |
| atlas-erp-frontend                    | AtlasERPFrontend            | compose                                  | puerto IP `:3010`                                                         |
| atlas-admin-portal                    | AtlasAdminPortal            | compose                                  | puerto IP `:3020`                                                         |
| atlas-decision-engine-backend (Motor) | AtlasDecisionEngineBackend  | compose                                  | `api`, `worker`, `migrate`, `motor-redis`; RLS por rol `atlas_app`        |
| atlas-decision-engine-frontend        | AtlasDecisionEngineFrontend | compose                                  | puerto IP `:3030`                                                         |
| atlas-pdf-worker                      | AtlasDecisionEngineBackend  | `/docker-compose.pdf-worker.coolify.yml` | worker compartido                                                         |
| atlas-dashboards-backend              | AtlasDashboardsBackend      | compose                                  | salud `/health` (sin prefijo)                                             |
| atlas-dashboards-frontend             | AtlasDashboardsFrontend     | compose                                  | puerto IP `:3040`                                                         |
| atlas-consumer-web                    | AtlasFrontend               | compose                                  | app del cliente en web                                                    |
| atlas-provider-mockup-server          | AtlasExternalProvidersMock  | compose                                  | **solo TEST/DEV: en PROD van los proveedores reales**                     |
| atlas-ai-service                      | AtlasAIService              | Dockerfile                               | `/docker-compose.yaml`; Postgres `atlas-ai-history-db` + `atlas-ai-redis` |
| atlas-landing                         | AtlasLandingPage            | compose local                            | `/opt/atlas/landing`                                                      |

Fuera de Coolify (a mano en `/opt/atlas`) [MEDIDO]: `postgres/`, `landing/`, `pdf-worker/`, `guardian/`, `lib/`, `monitor/`,
`respaldo-{apis,erp,ligeros,tableros,datos}/`, `respaldos/`.

**Variables de entorno:** Coolify registra solas las que el compose referencia (`${X:-}`), **vacías** y con
`is_buildtime=true`. «Existe» ≠ «tiene valor». Comprobar `strlen` de cada secreto y quitarle la marca de build.
Procedimiento: exportar la lista de _nombres_ por app desde `coolify-db` (`environment_variables`), rellenar los valores de
PROD en una bóveda (nunca los de TEST) y verificar que ninguno quede vacío.

## 3. Datos: PostgreSQL propio, redes y alias

[MEDIDO] Un solo contenedor `atlas-postgres` (`postgres:18-alpine`, `/opt/atlas/postgres/docker-compose.yml`, fuera de Coolify),
conectado a la red `coolify` y a la red de cada app con **alias `atlas-postgres`**. Bases: `atlas` (803 MB), `atlas_erp`,
`atlas_decision`, `atlas_dashboards`. Contraseña de `postgres` en `/opt/atlas/postgres/.env` (600).

Reglas que se heredan:

1. **Roles:** `migrate` con rol admin (`atlas_admin`, SUPERUSER solo para crear roles); **la API y el worker con `atlas_app`**
   (`rolsuper=false`, `rolbypassrls=false`) para que RLS no sea inerte. La contraseña de `atlas_app` en `.env.atlas_app` (600).
2. El compose del Motor decide el rol **al arrancar el contenedor** (`command: [sh,-c,'if [ -n "$$APP_DATABASE_URL" ]; then export DATABASE_URL=…']`),
   porque **Coolify no interpola defaults anidados** (`${A:-${B}}`).
3. Cada app nueva que use `atlas-postgres` necesita que este esté en SU red:
   `docker network connect --alias atlas-postgres <uuid> atlas-postgres`.
4. Una migración que escribe datos se prueba antes contra copia de la base desplegada (CLAUDE.md §3).
5. PROD: **base limpia de siembra** y sin `STARTUP_SEED_ENABLED`. Sin `decision_runtime_binding` el Motor responde
   `ACTIVE_DEPLOYMENT_NOT_FOUND`: publicar artefactos con dos firmas (CLAUDE.md §5) y correr
   `scripts/verificar-artefactos-publicados.mjs` antes de dar el entorno por listo.
6. Permisos nuevos de `internal-rbac.*` necesitan migración que repita el volcado del catálogo (§2 de CLAUDE.md).

Otros datos [MEDIDO]: `atlas-ai-history-db` (pg16) con backup `/etc/cron.d/atlas-ai-history-backup` a las 02:20;
MinIO por app (`minio-<uuid>`, RELEASE.2024-09-13T20-26-02Z en atlas-backend) con almacén persistente.

## 4. Entrada de red: Traefik, dominios, IP en bruto

[MEDIDO] Traefik con entrypoints `http:80`, `https:443` (+HTTP/3), `erp:3010`, `portal:3020`, `motor:3030`, `dash:3040`;
resolver `letsencrypt` (HTTP-01), `providers.file.directory=/traefik/dynamic/` con watch, `providers.docker` con
`exposedbydefault=false`.

Ficheros en `/data/coolify/proxy/dynamic/` (versionar todos en `_herramientas/` y copiarlos tal cual):

- `atlas-por-ip.yaml`: un puerto por portal para la IP en bruto (el filtro web FortiGuard de Pablo bloquea `*.sslip.io`).
- `atlas-dominios-propios.yaml`: `atlas.{adminportal,decisionengine,erp,consumerweb,dashboards}.test.arauzsoftware.com`.
- `atlas-{erp,tableros,ligeros,apis}-failover.yaml`: failover principal → respaldo (§6).
- `atlas-ai-por-ip.yaml`: `/ai/` por IP (gana por prioridad: excluir ese path de las reglas `Host(IP)` de prioridad 200).

**PROD:** dominios propios reales (no `sslip.io`), TLS por Let's Encrypt, y **probar desde la red de Pablo antes de dar
nada por listo** (`sh _herramientas/comprobar-desde-mi-red.sh`). **[DECIDE PABLO]** dominios finales y proveedor DNS.

## 5. Despliegue

- Flujo: PR → CI verde → merge → `git fetch -q origin && git push origin origin/dev:test` (patrón `promover-a-test.sh`).
  Para PROD el equivalente `origin/test:main` **solo con avance limpio** (`merge-base --is-ancestor`, `rev-list --count` = 0) y
  contrastando el sha impreso con el verificado.
- Un repo a la vez; mirar la cola (`application_deployment_queues` en `coolify-db`) antes del siguiente.
- «Desplegado» = cuerpo de `/api/v1/health` (`"service":"atlas-backend"`), commit de `/version` = el empujado, **no**
  `"version":"unknown"` (respaldo), **y** `docker ps -a --filter label=coolify.applicationId=<id>` sin contenedor `created`.
- Salud por app: AtlasBackend `/api/v1/health/readiness`; Motor `/health/live`; tableros `/health`.
- `NODE_ENV` no debe llegar al build de Coolify (rompe builds).
- Ver CLAUDE.md §1 y §4 (no `matar-builds`, no tocar el enfriamiento).

## 6. Resiliencia: el fallo que hay que prevenir y el patrón que funcionó

**Fallo [MEDIDO en TEST 2026-10-01/02]:** un despliegue retira el contenedor viejo con `docker rm`; con el host cargado
el demonio no termina y el nuevo queda en `created` sin arrancar. Coolify marca «failed» o incluso verde. Costó ERP 4 h 40 min y
tableros ~36 h sin que nadie lo viera.

**Patrón (replicar sin cambios):**

1. **Guardián** `atlas-guardian-test.timer` (60 s) → `/opt/atlas/guardian/guardian.sh`: sana `created` ≥120 s sin despliegue en curso,
   avisa CAÍDO/RECUPERADO, presta el alias de API al respaldo y promueve `:estable` cuando la principal lleva 10 min sana.
2. **Respaldo por app fuera del orquestador** con la última imagen sana (`:estable`): `respaldo-erp`, `respaldo-tableros`
   (API con `APP_ROLE=api`, sin cron), `respaldo-ligeros` (admin, motor-web, app web, mock), `respaldo-apis` (AtlasBackend y Motor).
   Sin build, sin migrate, sin workers, outbox y barridos apagados (`IDENTITY_RECONCILE_DISABLED=true`, `RUNTIME_JOBS_*`).
3. **Failover en Traefik** por fichero: `healthCheck` a 2 s, `retry` **solo en portales, nunca en APIs** (duplicaría escrituras).
4. **Alias estables** en cada compose (`erp`, `erp-web`, `erp-api-principal`, `admin-web`, `motor-web`, `consumer-web`,
   `atlas-backend`, `motor`, `atlas-dashboards-backend`, `external-providers-mock`); el nombre del contenedor cambia en
   cada despliegue, el alias no.
5. Los Redis viven solo en la red `<uuid>` del proyecto: el respaldo debe unirse a ella.
6. **Prueba obligatoria en PROD:** parar la principal 20 s midiendo cada segundo **desde el servidor** (`ssh -n`; un `ssh &`
   desde el Mac da 000 falsos). Referencia en TEST: portal 45/45 sondas OK; API 41/45 (hueco ~4 s, aceptado).

Estado hoy [MEDIDO]: 9 contenedores `atlas-*-respaldo` arriba; **`atlas-motor-respaldo` en `Created`** (un `d7de45156ff5_` huérfano de
un recreate): es exactamente la clase de fallo que este plan previene; revisar en TEST antes de copiarlo.

## 7. Monitoreo y el bot de Telegram

### 7.1 Piezas [MEDIDO + REPO `_herramientas/monitor-test/`]

| Pieza                                | Dónde                                     | Frecuencia                            |
| ------------------------------------ | ----------------------------------------- | ------------------------------------- |
| `atlas-monitor.timer`                | `/opt/atlas/monitor/monitor.sh`           | cada 60 s (~1,1 s de CPU)             |
| `atlas-guardian-test.timer`          | `/opt/atlas/guardian/guardian.sh`         | cada 60 s                             |
| `atlas-respaldo-datos.timer`         | `/opt/atlas/respaldo-datos/respaldar.sh`  | 00/06/12/18:15 UTC                    |
| `atlas-simulacro-restauracion.timer` | `/opt/atlas/respaldo-datos/simulacro.sh`  | domingos 03:30                        |
| Avisador común                       | `/opt/atlas/lib/avisar.sh` + `avisar.env` | lo usan guardián, monitor y respaldos |

Instalación [REPO]: copiar la carpeta al servidor y `sh instalar.sh` (instala scripts, unidades y `enable --now` del timer; crea
`monitor.env` vacío 600). Requiere antes `/opt/atlas/lib/avisar.sh` y `avisar.env`. **No toca Traefik ni Coolify.**

### 7.2 El bot de Telegram de TEST

- **Nombre:** `@atlas_test_avisos_bot` (creado con BotFather, activo desde 2026-10-03).
- **Dónde vive el token y el chat id:** `/opt/atlas/lib/avisar.env` y `/opt/atlas/guardian/.env` (permisos 600, solo root).
  **El token no está en este documento ni debe pegarse en ningún chat**: un token pegado en un chat queda expuesto
  (se resuelve con `/revoke` en BotFather).
- **Seguridad:** el monitor **solo atiende al chat de Pablo** (`TELEGRAM_CHAT_ID`). El bot **no tiene** `/reiniciar` ni `/desplegar` a propósito:
  si alguien lograra escribirle, no podría tocar el servidor. Solo `/silenciar` (calla avisos, máx. 6 h) y `/podar` (con confirmación
  en dos pasos) escriben algo.
- **Comandos:** `/status` (estado + gráfico PNG de 24 h) · `/apps` (cada app con su respaldo y memoria) · `/alertas` ·
  `/despliegues` (cola de Coolify) · `/negocio` (clientes, solicitudes, préstamos, pagos 24 h) · `/trafico` (5xx y p95) ·
  `/proveedores` · `/copias` · `/silenciar 1h|off` · `/ssh` (intentos, bloqueos, quién entró) · `/podar`.
- **Avisos:** solo por **cambio de estado**, con histéresis y mensaje «RECUPERADO»; informe diario 08:00; poda automática de la
  caché de build por encima de 150 GB (`docker builder prune --reserved-space 100GB`; en Docker 29 `--keep-storage` ya no existe).
- **Gráfico:** `grafico.py` con solo biblioteca estándar (el host no tiene PIL ni navegador).
- **Umbrales de alerta:** RAM < 2 GB, disco ≥ 85 % / 90 %, carga > 3×núcleos sostenida, copia de bases > 7 h, más de 2 % de 5xx, p95 alta,
  proveedores externos, cola de revisión con casos viejos, outbox creciendo.
- **Trampas medidas:** (1) abrir la ficha del bot en BotFather (mini app) y no el chat del bot deja `getUpdates` vacío hasta pulsar _Iniciar_;
  (2) `avisar.sh` leía `AVISO_MAIL_*` sin proteger y con `set -u` mataba la pasada tras el primer aviso (corregido);
  (3) `sh -x` imprime los secretos cargados: no usarlo con el `.env` puesto.
- Datos de negocio del monitor: `GET /systems/monitor/summary` con token de servicio (`ServiceTokenGuard`), reglas = las del portal
  (`systems-monitor.rules.ts`). **Sin `CONTEXT_SERVICE_TOKEN_SECRET` responde 503.**

### 7.3 Para PROD

1. **Bot nuevo y distinto** (p. ej. `@atlas_prod_avisos_bot`), con su propio token y su propio chat. **No reutilizar el de TEST**
   (Pablo decidió 2026-10-04 no revocar el de TEST; el de PROD nace aparte). Mejor aún: un grupo de guardia con 2 personas, y
   solo ese `chat_id` autorizado.
2. **Segundo canal por correo** (`AVISO_MAIL_*`) para el caso de que Telegram caiga.
3. `CONTEXT_SERVICE_TOKEN_SECRET` **propio de PROD**, nunca el de TEST.
4. Un **latido externo** (alguien que avise si el propio monitor deja de hablar): el monitor no puede avisar de su propia muerte.
5. Umbrales a revisar según el host definitivo.

## 8. Seguridad del host

[MEDIDO en TEST] `00-atlas-hardening.conf`: `PermitRootLogin prohibit-password`, `PasswordAuthentication no`, `LoginGraceTime 30`.
En sshd gana el **primer** valor: el drop-in debe llamarse `00-…` porque `50-cloud-init.conf` pone `yes`.

PROD desde el día 1:

1. Llave SSH instalada **antes** de endurecer; aplicar con `monitor-test/endurecer-ssh.sh` (**reversión automática a los 10 min si no se
   confirma**; confirmar solo tras probar con una segunda conexión. En TEST funcionó: la primera aplicación se revirtió sola).
2. `fail2ban` activo, **`ufw` activo**: permitir 22 (idealmente solo Tailscale/IP de Pablo), 80, 443; los puertos 3010–3040 y 8000
   (panel de Coolify) **no** públicos. Hoy en TEST `:8000`, `:6001`, `:6002`, `:8080` escuchan en `0.0.0.0` [MEDIDO].
3. Vigilancia con `monitor/ssh.sh`: IP nueva, contraseña, picos, fail2ban parado, deriva de `authorized_keys`.
4. Secretos en 600; nunca `docker inspect` impreso en logs compartidos (los respaldos de apps sin `.env` vuelcan variables así: 600).
5. Imágenes: los CVE vienen de la imagen base (npm de Node); fijar acciones de GitHub por sha (`fijar-actions-por-sha.py`).

## 9. Respaldos y recuperación

[MEDIDO/REPO] `respaldar.sh`: `pg_dump -Fc` por base verificado con `pg_restore --list` en `/opt/atlas/postgres/backups/<base>/`,
roles en `_globales/`, MinIO del Core por `rsync --link-dest`, `ULTIMO_OK` con sha256 y conteos; rotación 48 h / 14 diarias / 8 semanales.
`simulacro.sh` restaura cada domingo.

**Falta en TEST y es obligatorio en PROD:**

1. **Copia fuera del host** (hoy todo está en el mismo disco: perder el VPS = perder todo). Tirada desde otro sitio, cifrada,
   con retención. **[DECIDE PABLO]** destino (Backblaze/S3/otro VPS).
2. **Simulacro de restauración con medición de RTO/RPO** y acta firmada.
3. Respaldo de Coolify: `/data/coolify/{source,ssh,proxy,applications}` y `coolify-db`; copia del `acme.json` (certificados).
4. Respaldo de la bóveda de secretos, separado de todo lo anterior.

## 10. Orden de montaje de PROD (checklist)

1. Contratar host propio con la especificación del §1; Ubuntu 24.04.4; actualizar; fijar Docker 29.7.2.
2. Instalar llave SSH → `endurecer-ssh.sh` → confirmar → `ufw` + `fail2ban`.
3. `daemon.json`, `sysctl`, swap 4 GB, `staticroute` si aplica.
4. Instalar Coolify 4.3.23; `concurrent_builds=1`; conectar GitHub (deploy key por repo, solo lectura).
5. Crear `/opt/atlas/postgres` (pg18) con roles `atlas_admin`/`atlas_app` y las 4 bases; red y alias.
6. Copiar `dynamic/*.yaml` de Traefik y los entrypoints; apuntar DNS; emitir TLS.
7. Crear las apps de Coolify del §2 (sin el mock), una a una, **un repo a la vez** mirando la cola.
8. Cargar variables desde la bóveda; verificar `strlen` > 0 en cada secreto; quitar `is_buildtime` a secretos.
9. Publicar artefactos del Motor (dos firmas) y verificar con `verificar-artefactos-publicados.mjs`.
10. Montar respaldos `:estable` + failover; **probar parando 20 s** y midiendo.
11. Instalar guardián, monitor, `avisar.*`, bot **nuevo**; enviar `/status` y confirmar gráfico; probar una alerta y su «RECUPERADO».
12. Activar `respaldar.sh`, la copia fuera del host y correr el primer simulacro.
13. Comprobar **desde la red de Pablo** (`comprobar-desde-mi-red.sh`) y `docker ps -a` sin `created`.
14. Congelar: documentar versiones (imágenes con sha), exportar nombres de variables, registrar el acta.

## 11. Decisiones de configuración (definitivas, 2026-10-06)

Aprobadas por Pablo el 2026-10-06 («está perfecto»). Solo quedan abiertos el proveedor concreto del host y los nombres de dominio.

| Tema                 | Decisión                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host                 | Propio, solo Atlas: 8 vCPU / 24 GB RAM / 300 GB NVMe (Contabo o equivalente). El cuello de botella fue la CPU compartida, no la RAM                                                                              |
| Versiones            | Ubuntu 24.04 LTS, Docker 29.7.2, Coolify 4.3.23, Traefik v3.6, fijadas; `concurrent_builds=1`                                                                                                                    |
| Respaldos de apps    | Las 14 apps con failover de Traefik; prueba de parar la principal 20 s antes de salir                                                                                                                            |
| SSH                  | Solo llave, sin contraseña, `fail2ban` activo; `endurecer-ssh.sh` (reversión a los 10 min si no se confirma)                                                                                                     |
| Firewall             | `ufw` activo. 80 y 443 abiertos al mundo; 22 solo por Tailscale o IP de Pablo; 8000 y 3010–3040 NO públicos (acceso por Tailscale)                                                                               |
| Dominios             | Propios con TLS Let's Encrypt; nada de `sslip.io`; cada uno se prueba desde la red de Pablo antes de darlo por listo                                                                                             |
| Rama de producción   | `main`, solo recibe lo verificado en `test`; push `origin/test:main` con avance limpio y sha contrastado                                                                                                         |
| Copia fuera del host | Cifrada, nocturna, a almacenamiento de objetos externo (Backblaze B2 o S3)                                                                                                                                       |
| Retención            | 48 h / 14 diarias / 8 semanales (la de TEST)                                                                                                                                                                     |
| Simulacro            | Restauración semanal con tiempo medido (RTO/RPO)                                                                                                                                                                 |
| Bot de Telegram      | Nuevo y distinto al de TEST (p. ej. `@atlas_prod_avisos_bot`), token solo en `/opt/atlas/lib/avisar.env` (600); grupo de guardia de 2 personas y solo ese `chat_id` autorizado; sin `/reiniciar` ni `/desplegar` |
| Segundo canal        | Correo (`AVISO_MAIL_*`)                                                                                                                                                                                          |
| Aviso externo        | Servicio aparte (p. ej. UptimeRobot) que avise si el monitor deja de hablar                                                                                                                                      |
| NO se replica        | Mock de proveedores externos, siembra (`STARTUP_SEED_ENABLED=false`), `CONTEXT_SERVICE_TOKEN_SECRET` de TEST, Kafka y apps de otros proyectos                                                                    |

**Abiertas:** proveedor concreto del host, dominios finales y miembros del grupo de guardia.

## 12. Hallazgos del inventario de hoy (corregir en TEST antes de copiar)

- `atlas-motor-respaldo` quedó en `Created` (contenedor huérfano con prefijo de hash).
- Puertos de gestión (`:8000`, `:6001/6002`, `:8080`) abiertos al mundo y `ufw` inactivo.
- El host real (12 vCPU / 47 GiB) no coincide con la memoria del proyecto (8 / 23 GiB): actualizar.
- `svc-scm-planificacion` reinicia en bucle (otro proyecto, pero comparte host y CPU).
- `aportaya-postgres` y `deriva-tmp` caídos con exit 255 (otros proyectos).
- El H310 mantiene `atlas-test-*` y `atlas-auto-atlas` (`unhealthy`) vivos: confirmar si siguen haciendo falta; no son PROD.
