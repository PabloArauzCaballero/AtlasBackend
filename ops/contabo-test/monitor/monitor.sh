#!/bin/sh
# Informador de TEST (Contabo). Lo lanza atlas-monitor.timer cada minuto, con flock.
#
#   1. Mide el host (RAM, swap, carga, disco, caché de build) y las apps de Atlas (principal sana,
#      respaldo sano, memoria contra su límite, reinicios) y la antigüedad de la última copia de bases.
#   2. Avisa por Telegram SÓLO al cambiar de estado (con histéresis para lo ruidoso) y manda un
#      «RECUPERADO» al volver. Los avisos salen por /opt/atlas/lib/avisar.sh, igual que el guardián
#      y la copia de bases.
#   3. Informe diario a las 08:00 (hora del servidor, Bolivia) y a demanda: escribir /estado al bot.
#      Sólo contesta al chat de Pablo.
#   4. Poda la caché de build cuando pasa de CACHE_MAX_GB (docker builder prune --reserved-space, nunca
#      -a ni system prune), como mucho una vez cada 24 h.
#   5. Si hay MONITOR_URL + secreto de servicio (monitor.env), añade al informe y a las alertas el
#      resumen de AtlasBackend: red, tráfico, proveedores y negocio (ver resumen_backend).
#
# POSIX sh: los códigos se miran con $? justo después de cada orden, nunca tras una tubería.
set -u

E=/var/lib/atlas-monitor
mkdir -p "$E"
DIR=/opt/atlas/monitor
. /opt/atlas/lib/avisar.sh
[ -f "$DIR/monitor.env" ] && . "$DIR/monitor.env"
TELEGRAM_TOKEN=${TELEGRAM_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
# avisar.sh (común) lee estas tres sin protegerlas, y aquí rige `set -u`.
AVISO_MAIL_TO=${AVISO_MAIL_TO:-}
AVISO_MAIL_SECRET=${AVISO_MAIL_SECRET:-}
AVISO_MAIL_URL=${AVISO_MAIL_URL:-}
MONITOR_URL=${MONITOR_URL:-}
CACHE_MAX_GB=${CACHE_MAX_GB:-150}
CACHE_KEEP_GB=${CACHE_KEEP_GB:-100}

# id_coolify servicio_principal nombre respaldo_(contenedor|-)
APPS="
1 api atlas-backend atlas-backend-respaldo
2 api motor-backend atlas-motor-respaldo
3 api erp-backend atlas-erp-api-respaldo
4 api tableros-backend atlas-tableros-api-respaldo
5 portal portal-admin atlas-admin-web-respaldo
6 frontend erp-frontend atlas-erp-web-respaldo
7 frontend motor-frontend atlas-motor-web-respaldo
8 portal tableros-frontend atlas-tableros-web-respaldo
9 mock mock-proveedores atlas-mock-respaldo
12 pdf-worker pdf-worker -
14 web app-web-cliente atlas-consumer-web-respaldo
"

telegram() { # texto
  [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ] || return 0
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_TOKEN" |
    curl -s -m 10 -o /dev/null -K - --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1"
}

# chequeo clave malo(0|1) lecturas_seguidas texto_mal texto_bien
# Avisa una vez al pasar a MAL (tras N lecturas malas seguidas) y una vez al volver a OK.
chequeo() {
  c=0; [ -f "$E/c-$1" ] && c=$(cat "$E/c-$1")
  s=OK; [ -f "$E/s-$1" ] && s=$(cat "$E/s-$1")
  if [ "$2" = 1 ]; then
    c=$((c + 1)); echo "$c" > "$E/c-$1"
    if [ "$c" -ge "$3" ] && [ "$s" != MAL ]; then echo MAL > "$E/s-$1"; avisar "$4"; fi
  else
    echo 0 > "$E/c-$1"
    if [ "$s" = MAL ]; then echo OK > "$E/s-$1"; avisar "RECUPERADO: $5"; fi
  fi
}

a_gb() { awk -v s="$1" 'BEGIN{n=s+0; if(s~/TB/)n*=1024; else if(s~/MB/)n/=1024; else if(s~/kB/)n/=1048576; printf "%d", n}'; }
mayor() { awk -v a="$1" -v b="$2" 'BEGIN{print (a>b)?1:0}'; }

# --- 1. Host ---------------------------------------------------------------------------------
mem_av=$(free -m | awk '/^Mem:/{print $7}')
swap_libre=$(free -m | awk '/^Swap:/{print $4}')
load1=$(awk '{print $1}' /proc/loadavg)
load15=$(awk '{print $3}' /proc/loadavg)
nproc=$(nproc)
disco=$(df --output=pcent / | tail -1 | tr -dc 0-9)

# docker system df es caro (tarda segundos con 100+ contenedores): cada 30 min.
if [ ! -f "$E/cache_gb" ] || [ -n "$(find "$E/cache_gb" -mmin +30 2>/dev/null)" ]; then
  linea=$(docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | grep '^Build Cache|' | cut -d'|' -f2)
  [ -n "$linea" ] && a_gb "$linea" > "$E/cache_gb"
fi
cache_gb=$(cat "$E/cache_gb" 2>/dev/null || echo 0)

chequeo ram "$([ "$mem_av" -lt 2048 ] && echo 1 || echo 0)" 3 \
  "RAM: quedan ${mem_av} MB disponibles en Contabo (aviso por debajo de 2048)." \
  "la RAM disponible vuelve a ${mem_av} MB."
chequeo disco85 "$([ "$disco" -ge 85 ] && echo 1 || echo 0)" 1 \
  "DISCO al ${disco}% en Contabo (aviso desde el 85%). Caché de build: ${cache_gb} GB." \
  "el disco baja al ${disco}%."
chequeo disco90 "$([ "$disco" -ge 90 ] && echo 1 || echo 0)" 1 \
  "DISCO CRÍTICO al ${disco}%: la copia de bases deja de respaldar por encima del 90%." \
  "el disco baja del 90% (${disco}%)."
chequeo cache "$([ "$cache_gb" -gt "$CACHE_MAX_GB" ] && echo 1 || echo 0)" 1 \
  "la caché de build ocupa ${cache_gb} GB (tope ${CACHE_MAX_GB}). La poda automática actúa una vez al día." \
  "la caché de build baja a ${cache_gb} GB."
chequeo carga "$(mayor "$load15" "$((nproc * 3))")" 15 \
  "CARGA del servidor ${load15} (15 min) con ${nproc} núcleos: más de 3 por núcleo sostenido. Suele ser un build o un proyecto vecino." \
  "la carga baja a ${load15}."

# --- 4. Poda de la caché de build (una vez cada 24 h) ----------------------------------------
if [ "$cache_gb" -gt "$CACHE_MAX_GB" ] && [ -z "$(find "$E/poda" -mmin -1440 2>/dev/null)" ]; then
  : > "$E/poda"
  docker builder prune -f --reserved-space "${CACHE_KEEP_GB}GB" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    linea=$(docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | grep '^Build Cache|' | cut -d'|' -f2)
    despues=$(a_gb "${linea:-0GB}")
    echo "$despues" > "$E/cache_gb"
    avisar "Caché de build podada de ${cache_gb} GB a ${despues} GB (se conserva lo más reciente; no se tocó nada en uso)."
    cache_gb=$despues
  else
    avisar "La poda de la caché de build FALLÓ (${cache_gb} GB). Mirar a mano: docker builder prune --reserved-space."
  fi
fi

# --- 2. Apps ---------------------------------------------------------------------------------
sanas=0; total=0; problemas=""; resp_ok=0; resp_total=0
echo "$APPS" > "$E/apps.lista"
# Una sola llamada a docker para todas las apps: el estado y la salud salen de la columna Status.
docker ps --format '{{.Names}}|{{.Label "coolify.applicationId"}}|{{.Label "com.docker.compose.service"}}|{{.Status}}' > "$E/ps.txt" 2>/dev/null
salud_de() { # texto de Status -> healthy|unhealthy|starting|none|ausente
  case "$1" in
    '') echo ausente ;;
    *'(unhealthy)'*) echo unhealthy ;;
    *'(healthy)'*) echo healthy ;;
    *'starting)'*) echo starting ;;
    *) echo none ;;
  esac
}
while read -r app svc nombre resp; do
  [ -z "${app:-}" ] && continue
  total=$((total + 1))
  st=$(awk -F'|' -v a="$app" -v s="$svc" '$2==a && $3==s {print $4; exit}' "$E/ps.txt")
  salud=$(salud_de "$st")
  if [ "$salud" = healthy ] || [ "$salud" = none ]; then sanas=$((sanas + 1)); else problemas="$problemas $nombre($salud)"; fi
  # «ausente» lo avisa el guardián (CAÍDO); aquí sólo «en marcha pero no sana».
  chequeo "app-$app" "$([ "$salud" = unhealthy ] && echo 1 || echo 0)" 3 \
    "$nombre: el contenedor principal está en marcha pero NO sano. Si tiene respaldo, Traefik ya sirve desde él." \
    "$nombre vuelve a estar sano."
  if [ "$resp" != - ]; then
    resp_total=$((resp_total + 1))
    rs=$(salud_de "$(awk -F'|' -v n="$resp" '$1==n {print $4; exit}' "$E/ps.txt")")
    [ "$rs" = healthy ] && resp_ok=$((resp_ok + 1))
    chequeo "resp-$app" "$([ "$rs" != healthy ] && echo 1 || echo 0)" 3 \
      "El RESPALDO de $nombre ($resp) está $rs: si cae la principal, no hay quien la sustituya." \
      "el respaldo de $nombre vuelve a estar sano."
  fi
done < "$E/apps.lista"

# Memoria contra el límite y reinicios, sólo de contenedores de Atlas (y sus respaldos), cada 5 min.
if [ ! -f "$E/mem.txt" ] || [ -n "$(find "$E/mem.txt" -mmin +4 2>/dev/null)" ]; then
  nombres=$(awk -F'|' '$2 ~ /^(1|2|3|4|5|6|7|8|9|12|14|26)$/ || $1 ~ /-respaldo$/ {print $1}' "$E/ps.txt")
  # shellcheck disable=SC2086
  [ -n "$nombres" ] && docker stats --no-stream --format '{{.Name}}|{{.MemPerc}}|{{.MemUsage}}' $nombres > "$E/mem.txt.n" 2>/dev/null && mv "$E/mem.txt.n" "$E/mem.txt"
  # Reinicios: un solo docker inspect para todos.
  # shellcheck disable=SC2086
  [ -n "$nombres" ] && docker inspect -f '{{.Name}} {{.RestartCount}}' $nombres 2>/dev/null | sed 's#^/##' | while read -r n r; do
    antes=$r; [ -f "$E/r-$n" ] && antes=$(cat "$E/r-$n")
    echo "$r" > "$E/r-$n"
    [ "$r" -gt "$antes" ] && avisar "REINICIO: $n se reinició $((r - antes)) vez/veces (total $r). Mirar docker logs $n."
  done
fi
if [ -f "$E/mem.txt" ]; then
  while IFS='|' read -r n pct uso; do
    [ -z "$n" ] && continue
    p=${pct%\%}
    clave=$(printf 'mem-%s' "$n" | tr -c 'A-Za-z0-9\n-' '_')
    chequeo "$clave" "$(mayor "${p:-0}" 90)" 2 \
      "MEMORIA: $n al ${pct} de su límite ($uso). Riesgo de que lo mate el sistema." \
      "$n baja de memoria (${pct})."
  done < "$E/mem.txt"
fi

# --- 1b. Última copia de bases -----------------------------------------------------------------
ult=/opt/atlas/postgres/backups/ULTIMO_OK
edad_h=-1
if [ -f "$ult" ]; then edad_h=$(( ($(date +%s) - $(stat -c %Y "$ult")) / 3600 )); fi
chequeo copia "$([ "$edad_h" -lt 0 ] || [ "$edad_h" -ge 7 ] && echo 1 || echo 0)" 1 \
  "COPIA DE BASES: la última copia buena tiene ${edad_h} h (debe ser cada 6 h). Mirar journalctl -u atlas-respaldo-datos." \
  "la copia de bases vuelve a estar al día."

# --- 5. Resumen de AtlasBackend (red, tráfico, proveedores, negocio) ---------------------------
# GET /api/v1/systems/monitor/summary con token de servicio (JWT HS256 de 60 s, audiencia
# atlas-ctx-systems, servicio atlas-monitor). Sin CONTEXT_SERVICE_TOKEN_SECRET en monitor.env este
# bloque no hace nada y el informe sale sólo con lo del servidor. Se consulta cada 5 min: el resumen
# toca la base (percentiles de 24 h de tráfico) y no hace falta más.
MONITOR_TENANT_ID=${MONITOR_TENANT_ID:-}
CONTEXT_SERVICE_TOKEN_SECRET=${CONTEXT_SERVICE_TOKEN_SECRET:-}
JWT_ISSUER=${JWT_ISSUER:-atlas-backend}
MONITOR_HOST=${MONITOR_HOST:-api.161.97.85.216.sslip.io}
RESUMEN=""

b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
token_servicio() {
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
  n=$(date +%s)
  p=$(printf '{"svc":"atlas-monitor","tenantId":"%s","scopes":["systems:monitor:read"],"res":null,"jti":"%s","iss":"%s","aud":"atlas-ctx-systems","sub":"service:atlas-monitor","iat":%s,"exp":%s}' \
    "$MONITOR_TENANT_ID" "$(cat /proc/sys/kernel/random/uuid)" "$JWT_ISSUER" "$n" "$((n + 60))" | b64)
  f=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$CONTEXT_SERVICE_TOKEN_SECRET" -binary | b64)
  printf '%s.%s.%s' "$h" "$p" "$f"
}

ico() { case "$1" in ok) printf '🟢' ;; warn) printf '🟠' ;; bad) printf '🔴' ;; *) printf '⚪' ;; esac; }
j() { jq -r "$1" "$E/resumen.json" 2>/dev/null; }

resumen_backend() {
  [ -n "$CONTEXT_SERVICE_TOKEN_SECRET" ] && [ -n "$MONITOR_TENANT_ID" ] || return 0
  if [ ! -f "$E/resumen.json" ] || [ -n "$(find "$E/resumen.json" -mmin +4 2>/dev/null)" ]; then
    codigo=$(printf 'header = "Authorization: Bearer %s"\n' "$(token_servicio)" |
      curl -s -m 25 -o "$E/resumen.n" -w '%{http_code}' -K - -H "Host: $MONITOR_HOST" \
        "http://127.0.0.1/api/v1/systems/monitor/summary")
    if [ "$codigo" = 200 ] && jq -e '(.data // .) | .overall' "$E/resumen.n" >/dev/null 2>&1; then
      jq '(.data // .)' "$E/resumen.n" > "$E/resumen.json"; rm -f "$E/resumen.n"
      chequeo resumen 0 3 "" "el resumen de monitoreo de AtlasBackend vuelve a responder."
    else
      rm -f "$E/resumen.n"
      chequeo resumen 1 3 "El resumen de monitoreo de AtlasBackend NO responde (HTTP ${codigo:-sin respuesta}). Sin él no hay alertas de red, tráfico, proveedores ni negocio." ""
      return 0
    fi
    # Alertas por cambio de estado, lecturas cada 5 min.
    caidos=$(j '[.network.blocks[]? | select(.liveState=="DOWN" or .liveState=="DEGRADED") | "\(.systemCode)=\(.liveState)"] | join(", ")')
    chequeo red "$([ "$(j .network.status)" = bad ] && echo 1 || echo 0)" 2 \
      "RED: bloque del ecosistema caído (${caidos:-?}). Mirar Operaciones › Salud de la red en el portal." "los bloques del ecosistema vuelven a estar arriba."
    herr=$(j '[.criticalTools.down[]? | .name] | join(", ")')
    chequeo herramientas "$([ "$(j .criticalTools.status)" = bad ] && echo 1 || echo 0)" 2 \
      "HERRAMIENTA CRÍTICA caída: ${herr:-?}." "las herramientas críticas vuelven a responder."
    chequeo trafico "$([ "$(j .traffic.last15m.status)" = bad ] && echo 1 || echo 0)" 2 \
      "TRÁFICO: más del 2% de errores 5xx en los últimos 15 min ($(j '.traffic.last15m.serverErrorRate * 100 | floor')% de $(j .traffic.last15m.totalRequests) peticiones)." "los errores 5xx bajan del 2%."
    chequeo latencia "$([ "$(j .traffic.last15m.status)" = warn ] && echo 1 || echo 0)" 3 \
      "LATENCIA: p95 de $(j .traffic.last15m.p95LatencyMs) ms en los últimos 15 min (aviso desde 2000 ms)." "la latencia p95 baja de 2 s."
    chequeo proveedores "$([ "$(j .providers.status)" = bad ] && echo 1 || echo 0)" 2 \
      "PROVEEDORES EXTERNOS: éxito de $(j .providers.successRate)% con $(j .providers.respondingProviders) de $(j .providers.providers) respondiendo (aviso por debajo de 80%)." "los proveedores externos se recuperan."
    chequeo entrega "$([ "$(j .outcomes.status)" = bad ] && echo 1 || echo 0)" 1 \
      "ENTREGA AL MOTOR: $(j .outcomes.exhausted) desenlaces agotaron los reintentos; el modelo pierde muestra." "la entrega de desenlaces al Motor vuelve a ir al día."
    chequeo cola "$([ "$(j .queue.status)" = warn ] && echo 1 || echo 0)" 1 \
      "COLA DE REVISIÓN: hay $(j .queue.reviewOpen) casos abiertos y el más antiguo lleva $(j .queue.oldestOpenAgeHours) h (aviso pasadas 24 h)." "la cola de revisión vuelve a estar al día."
    # Outbox: aviso si sube tres lecturas seguidas y pasa de 50.
    ob=$(j .outbox.pending); ob=${ob:-0}
    echo "$ob" >> "$E/outbox.hist"; tail -n 3 "$E/outbox.hist" > "$E/outbox.hist.n"; mv "$E/outbox.hist.n" "$E/outbox.hist"
    sube=$(awk 'NR==1{a=$1} NR==2{b=$1} NR==3{c=$1} END{print (NR==3 && a<b && b<c && c>50)?1:0}' "$E/outbox.hist")
    chequeo outbox "$sube" 1 "OUTBOX: ${ob} eventos pendientes y subiendo tres lecturas seguidas. El relé puede estar parado." "el outbox deja de crecer (${ob} pendientes)."
  fi
  [ -f "$E/resumen.json" ] || return 0
  RESUMEN="Red: $(ico "$(j .network.status)") $(j '[.network.blocks[]? | "\(.systemCode) \(.liveState)"] | join(" · ")')
Tráfico 24 h: $(ico "$(j .traffic.last24h.status)") $(j .traffic.last24h.totalRequests) peticiones · p95 $(j .traffic.last24h.p95LatencyMs) ms · errores $(j '(.traffic.last24h.serverErrorRate * 1000 | floor) / 10')%$(j 'if .traffic.last24h.slowestRoute then " · lenta: \(.traffic.last24h.slowestRoute.method) \(.traffic.last24h.slowestRoute.route) (\(.traffic.last24h.slowestRoute.p95LatencyMs) ms)" else "" end')
Proveedores: $(ico "$(j .providers.status)") $(j '"\(.providers.respondingProviders)/\(.providers.providers) responden · éxito \(.providers.successRate // "s/d")%"')
Entrega al Motor: $(ico "$(j .outcomes.status)") $(j '"pendientes \(.outcomes.pending) · reintentando \(.outcomes.retrying) · agotados \(.outcomes.exhausted)"')
Negocio 24 h: $(j '.business.last24h | "clientes nuevos \(.customersNew) · solicitudes \(.applicationsNew) (aprobadas \(.applicationsApproved)) · préstamos \(.loansNew) · pagos \(.paymentsNew) · comercios nuevos \(.merchantsNew)"') · comercios aprobados $(j .business.merchantsApproved)
Cola de revisión: $(ico "$(j .queue.status)") $(j .queue.reviewOpen) abiertos$(j 'if .queue.oldestOpenAgeHours then " (el más antiguo \(.queue.oldestOpenAgeHours) h)" else "" end') · Outbox pendiente: $(j .outbox.pending)"
}
resumen_backend

# --- 3. Informe ------------------------------------------------------------------------------
informe() {
  ahora_h=$(date +%H:%M)
  gb=$(awk -v m="$mem_av" 'BEGIN{printf "%.1f", m/1024}')
  semaforo="🟢"
  [ -n "$problemas" ] || [ "$resp_ok" -lt "$resp_total" ] || [ "$mem_av" -lt 2048 ] || [ "$disco" -ge 85 ] && semaforo="🟠"
  [ "$disco" -ge 90 ] && semaforo="🔴"
  t="$semaforo Atlas TEST · estado a las $ahora_h (Bolivia)
Servidor: RAM libre ${gb} GB · swap libre ${swap_libre} MB · carga ${load1} (${nproc} núcleos) · disco ${disco}% · caché de build ${cache_gb} GB
Apps de Atlas: ${sanas}/${total} sanas · respaldos ${resp_ok}/${resp_total} sanos"
  [ -n "$problemas" ] && t="$t
Con problema:$problemas"
  if [ "$edad_h" -ge 0 ]; then t="$t
Copia de bases: hace ${edad_h} h"; else t="$t
Copia de bases: SIN DATOS"; fi
  [ -n "$RESUMEN" ] && t="$t
$RESUMEN"
  printf '%s' "$t"
}

# A demanda: /estado al bot (sólo del chat de Pablo).
if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  off=0; [ -f "$E/offset" ] && off=$(cat "$E/offset")
  printf 'url = "https://api.telegram.org/bot%s/getUpdates"\n' "$TELEGRAM_TOKEN" |
    curl -s -m 10 -K - --data-urlencode "offset=$off" --data-urlencode "timeout=0" > "$E/upd.json" 2>/dev/null
  if jq -e '.ok == true' "$E/upd.json" >/dev/null 2>&1; then
    pedir=0
    for fila in $(jq -r '.result[] | "\(.update_id)|\(.message.chat.id // 0)|\((.message.text // "") | split(" ")[0] | split("@")[0])"' "$E/upd.json"); do
      id=${fila%%|*}; resto=${fila#*|}; chat=${resto%%|*}; cmd=${resto#*|}
      off=$((id + 1))
      [ "$chat" = "$TELEGRAM_CHAT_ID" ] && [ "$cmd" = "/estado" ] && pedir=1
    done
    echo "$off" > "$E/offset"
    [ "$pedir" = 1 ] && telegram "$(informe)"
  fi
  rm -f "$E/upd.json"
fi

# Diario a las 08:00.
hoy=$(date +%Y%m%d)
if [ "$(date +%H)" -ge 8 ] && [ ! -f "$E/diario-$hoy" ]; then
  rm -f "$E"/diario-*
  : > "$E/diario-$hoy"
  telegram "$(informe)"
fi
log "pasada completa"
