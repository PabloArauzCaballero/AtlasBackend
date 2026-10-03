# Comandos del bot de avisos de TEST. Lo carga monitor.sh (`. comandos.sh`); no se ejecuta solo.
#
# Todos son de LECTURA salvo /silenciar (calla avisos un rato) y /podar (poda la caché de build, con
# confirmación en dos pasos). No hay /reiniciar ni /desplegar a propósito: si alguien consiguiera escribir
# al bot, no debería poder tocar el servidor. El monitor sólo atiende al chat de Pablo (TELEGRAM_CHAT_ID).
#
# Usa lo que monitor.sh ya tiene a mano en cada pasada: $E (estado), ps.txt, mem.txt, apps.lista,
# resumen.json, y las funciones telegram, telegram_informe, informe, salud_de, ico, j.

hace() { # segundos -> «2 h 5 min»
  if [ "$1" -ge 3600 ]; then printf '%s h %s min' $(($1 / 3600)) $((($1 % 3600) / 60))
  elif [ "$1" -ge 60 ]; then printf '%s min' $(($1 / 60))
  else printf '%s s' "$1"; fi
}

nombre_app() { awk -v a="$1" '$1==a {print $3; exit}' "$E/apps.lista" 2>/dev/null; }

nombre_clave() { # clave de estado -> texto legible
  case "$1" in
    ram) echo "RAM baja" ;; disco85) echo "Disco al 85 % o más" ;; disco90) echo "Disco al 90 % o más" ;;
    cache) echo "Caché de build por encima del tope" ;; carga) echo "Carga alta sostenida" ;;
    copia) echo "Copia de bases atrasada" ;; red) echo "Bloque del ecosistema caído" ;;
    herramientas) echo "Herramienta crítica caída" ;; trafico) echo "Más del 2 % de errores 5xx" ;;
    latencia) echo "Latencia p95 alta" ;; proveedores) echo "Proveedores externos" ;;
    entrega) echo "Entrega de desenlaces al Motor" ;; cola) echo "Cola de revisión con casos viejos" ;;
    outbox) echo "Outbox creciendo" ;; resumen) echo "Resumen de AtlasBackend sin respuesta" ;;
    instantanea) echo "La instantánea no llega al portal" ;;
    app-*) echo "$(nombre_app "${1#app-}"): principal en marcha pero no sana" ;;
    resp-*) echo "$(nombre_app "${1#resp-}"): respaldo no sano" ;;
    mem-*) echo "Memoria alta: ${1#mem-}" ;;
    *) echo "$1" ;;
  esac
}

silencio_activo() { # imprime la hora hasta la que están silenciadas, o nada
  [ -f "$E/silencio-hasta" ] || return 0
  hasta=$(cat "$E/silencio-hasta")
  [ "$(date +%s)" -lt "$hasta" ] && date -d "@$hasta" +%H:%M
  return 0
}

sin_resumen() {
  telegram "⚪ El resumen de AtlasBackend todavía no está habilitado en TEST (falta crear el secreto de servicio y desplegar el PR del monitor). Mientras tanto $1 no tiene datos."
}

resumen_fresco() { [ -f "$E/resumen.json" ] && [ -z "$(find "$E/resumen.json" -mmin +15 2>/dev/null)" ]; }

cmd_ayuda() {
  telegram "Comandos del bot de TEST:
/status · estado del servidor con gráfico de 24 h
/apps · cada app con su respaldo y su memoria
/alertas · qué está en rojo ahora y desde cuándo
/despliegues · últimos despliegues de Coolify y la cola
/negocio · clientes, solicitudes, préstamos y pagos de 24 h
/trafico · errores y latencia (15 min y 24 h)
/proveedores · proveedores externos
/copias · última copia de las bases
/silenciar 1h · calla los avisos (máx. 6 h; /silenciar off la quita)
/podar · poda la caché de build (pide confirmación)"
}

cmd_alertas() {
  out=""; n=0
  for f in "$E"/s-*; do
    [ -f "$f" ] && [ "$(cat "$f")" = MAL ] || continue
    k=${f##*/s-}; desde=$(($(date +%s) - $(stat -c %Y "$f")))
    out="$out
🔴 $(nombre_clave "$k") — desde hace $(hace "$desde")"
    n=$((n + 1))
  done
  mudo=$(silencio_activo); nota=""; [ -n "$mudo" ] && nota="
🔕 Avisos silenciados hasta las $mudo."
  if [ "$n" = 0 ]; then telegram "🟢 Sin alertas activas.$nota"; else telegram "Alertas activas ($n):$out$nota"; fi
}

cmd_apps() {
  t="Apps de Atlas en TEST:"
  while read -r app svc nombre resp; do
    [ -z "${app:-}" ] && continue
    st=$(awk -F'|' -v a="$app" -v s="$svc" '$2==a && $3==s {print $1"|"$4; exit}' "$E/ps.txt")
    cn=${st%%|*}; sal=$(salud_de "${st#*|}")
    case "$sal" in healthy | none) i="🟢" ;; starting) i="🟠" ;; *) i="🔴" ;; esac
    rtxt="sin respaldo"
    if [ "$resp" != - ]; then
      rs=$(salud_de "$(awk -F'|' -v n="$resp" '$1==n {print $4; exit}' "$E/ps.txt")")
      [ "$rs" = healthy ] && rtxt="respaldo sano" || rtxt="RESPALDO $rs"
    fi
    mp=""; [ -n "$cn" ] && mp=$(awk -F'|' -v n="$cn" '$1==n {print $2; exit}' "$E/mem.txt" 2>/dev/null)
    rr=""; [ -n "$cn" ] && [ -f "$E/r-$cn" ] && [ "$(cat "$E/r-$cn")" -gt 0 ] && rr=" · reinicios $(cat "$E/r-$cn")"
    t="$t
$i $nombre ($sal) · $rtxt${mp:+ · mem $mp}$rr"
  done < "$E/apps.lista"
  telegram "$t"
}

cmd_despliegues() {
  ids="'1','2','3','4','5','6','7','8','9','12','14','26'"
  filas=$(docker exec coolify-db psql -U coolify -d coolify -At -F '|' -c "
    select application_name, status, left(coalesce(commit,''),7),
           to_char(created_at at time zone 'America/La_Paz','DD HH24:MI'),
           coalesce(extract(epoch from (finished_at - created_at))::int, extract(epoch from (now() - created_at))::int)
      from application_deployment_queues where application_id in ($ids) order by id desc limit 8" 2>/dev/null)
  en_cola=$(docker exec coolify-db psql -U coolify -d coolify -Atc "select count(*) from application_deployment_queues where status in ('in_progress','queued')" 2>/dev/null)
  [ -n "$filas" ] || { telegram "⚪ No pude leer la cola de despliegues de Coolify."; return 0; }
  t="Últimos despliegues (hora Bolivia):"
  OLDIFS=$IFS; IFS='
'
  for fila in $filas; do
    IFS='|'; set -- $fila; IFS=$OLDIFS
    case "$2" in
      finished) i="🟢" ;; failed) i="🔴" ;; in_progress) i="🔨" ;; queued) i="⏳" ;; *) i="⚪" ;;
    esac
    t="$t
$i $1 · $3 · $4 · $2 · $(hace "${5:-0}")"
    IFS='
'
  done
  IFS=$OLDIFS
  telegram "$t

En cola o construyendo ahora (todos los proyectos): ${en_cola:-?}"
}

cmd_negocio() {
  resumen_fresco || { sin_resumen "/negocio"; return 0; }
  telegram "Negocio (últimas 24 h)
$(j '.business.last24h | "Clientes nuevos: \(.customersNew)\nSolicitudes de crédito: \(.applicationsNew) (aprobadas \(.applicationsApproved))\nPréstamos nuevos: \(.loansNew)\nPagos registrados: \(.paymentsNew)\nComercios nuevos: \(.merchantsNew)"')
Comercios aprobados en total: $(j .business.merchantsApproved)
Cola de revisión: $(ico "$(j .queue.status)") $(j .queue.reviewOpen) abiertos$(j 'if .queue.oldestOpenAgeHours then " (el más antiguo \(.queue.oldestOpenAgeHours) h)" else "" end')
Entrega al Motor: $(ico "$(j .outcomes.status)") $(j '"pendientes \(.outcomes.pending) · reintentando \(.outcomes.retrying) · agotados \(.outcomes.exhausted)"')
Outbox pendiente: $(j .outbox.pending)"
}

cmd_trafico() {
  resumen_fresco || { sin_resumen "/trafico"; return 0; }
  telegram "Tráfico de la API
Últimos 15 min: $(ico "$(j .traffic.last15m.status)") $(j '.traffic.last15m | "\(.totalRequests) peticiones · p95 \(.p95LatencyMs) ms · errores 5xx \((.serverErrorRate * 1000 | floor) / 10)%"')
Últimas 24 h: $(ico "$(j .traffic.last24h.status)") $(j '.traffic.last24h | "\(.totalRequests) peticiones · p95 \(.p95LatencyMs) ms · errores 5xx \((.serverErrorRate * 1000 | floor) / 10)%"')
$(j 'if .traffic.last24h.slowestRoute then "Ruta más lenta (24 h): \(.traffic.last24h.slowestRoute.method) \(.traffic.last24h.slowestRoute.route) · p95 \(.traffic.last24h.slowestRoute.p95LatencyMs) ms" else "" end')"
}

cmd_proveedores() {
  resumen_fresco || { sin_resumen "/proveedores"; return 0; }
  telegram "Proveedores externos: $(ico "$(j .providers.status)")
$(j '.providers | "Responden \(.respondingProviders) de \(.providers) (sin medir: \(.unmeasuredProviders))\nÉxito de las llamadas: \(.successRate // "s/d")%\nLlamadas: \(.totalCalls) · fallidas \(.failedCalls) · bloqueadas \(.blockedCalls)\nLatencia p95 más alta: \(.worstP95LatencyMs // "s/d") ms"')"
}

cmd_copias() {
  ult=/opt/atlas/postgres/backups/ULTIMO_OK
  [ -f "$ult" ] || { telegram "🔴 No hay ULTIMO_OK: la copia de bases nunca terminó bien."; return 0; }
  edad=$(($(date +%s) - $(stat -c %Y "$ult")))
  lista=$(awk '/^base=/ { for (i = 1; i <= NF; i++) { split($i, kv, "="); v[kv[1]] = kv[2] }
        printf "• %s: %.1f MB · %s filas\n", v["base"], v["bytes"] / 1048576, v["filas_aprox"] }' "$ult")
  objetos=$(awk -F= '/^minio=/ {for (i = 1; i <= NF; i++) if ($i ~ /objetos/) print $(i + 1)}' "$ult" | head -1)
  telegram "Última copia de las bases: hace $(hace "$edad") ($(grep '^fecha=' "$ult" | cut -d= -f2))
$lista${objetos:+
Archivos del almacén (MinIO): $objetos}
Se hace cada 6 h; el monitor avisa si pasan 7."
}

cmd_silenciar() { # arg: 30m | 1h | 2h | off
  case "$1" in
    off | 0 | no) rm -f "$E/silencio-hasta"; telegram "🔔 Avisos reactivados."; return 0 ;;
  esac
  arg=${1:-1h}
  num=${arg%[mh]}; unidad=${arg#"$num"}
  case "$num" in '' | *[!0-9]*) telegram "Uso: /silenciar 30m · /silenciar 2h · /silenciar off"; return 0 ;; esac
  [ "$unidad" = h ] && seg=$((num * 3600)) || seg=$((num * 60))
  [ "$seg" -gt 21600 ] && seg=21600
  echo $(($(date +%s) + seg)) > "$E/silencio-hasta"
  telegram "🔕 Avisos silenciados $(hace "$seg") (hasta las $(date -d "+$seg seconds" +%H:%M)). Los cambios de estado se siguen registrando: /alertas los enseña. Máximo 6 h."
}

cmd_podar() { # arg: confirmar
  if [ "$1" = confirmar ]; then
    pend=0; [ -f "$E/podar-pendiente" ] && pend=$(cat "$E/podar-pendiente")
    if [ $(($(date +%s) - pend)) -gt 120 ]; then telegram "Primero escribe /podar y luego /podar confirmar (tienes 2 minutos)."; return 0; fi
    rm -f "$E/podar-pendiente"
    # En una unidad aparte: la poda tarda minutos y esta pasada no debe quedarse esperándola.
    systemd-run --no-block --collect --quiet --unit="atlas-poda-$(date +%s)" /bin/sh "$DIR/podar.sh" \
      && telegram "🧹 Poda de la caché de build en marcha. Te aviso al terminar (puede tardar unos minutos)." \
      || telegram "🔴 No pude lanzar la poda."
    return 0
  fi
  echo "$(date +%s)" > "$E/podar-pendiente"
  telegram "La caché de build ocupa ${cache_gb} GB. La poda borra lo más viejo y deja 100 GB; no toca nada en uso, pero el siguiente build puede tardar más. Para confirmar escribe /podar confirmar en los próximos 2 minutos."
}
