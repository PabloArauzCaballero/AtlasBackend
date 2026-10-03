# Aviso común de TEST (guardián, respaldos, disco). Se carga con `. /opt/atlas/lib/avisar.sh`.
# Siempre escribe en el journal; además Telegram y/o correo firmado por el Core si hay configuración
# en /opt/atlas/lib/avisar.env (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, AVISO_MAIL_TO, AVISO_MAIL_SECRET,
# AVISO_MAIL_URL). Sin configuración sólo queda el journal: `journalctl -t atlas-aviso`.
[ -f /opt/atlas/lib/avisar.env ] && . /opt/atlas/lib/avisar.env
log() { echo "$(date -u +%H:%M:%S) $*"; }
avisar() {
  log "AVISO: $1"
  logger -t atlas-aviso -p user.warning "$1" 2>/dev/null
  if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_TOKEN" |
      curl -s -m 10 -o /dev/null -K - --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=[Atlas TEST] $1"
  fi
  if [ -n "$AVISO_MAIL_TO" ] && [ -n "$AVISO_MAIL_SECRET" ] && [ -n "$AVISO_MAIL_URL" ]; then
    t=$(date +%s)
    texto=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
    cuerpo="{\"to\":\"$AVISO_MAIL_TO\",\"subject\":\"[Atlas TEST] aviso de infraestructura\",\"text\":\"$texto\",\"reference\":\"aviso-$t\"}"
    firma=$(printf '%s.%s' "$t" "$cuerpo" | openssl dgst -sha256 -hmac "$AVISO_MAIL_SECRET" | sed 's/^.* //')
    curl -s -m 15 -o /dev/null -X POST "$AVISO_MAIL_URL" -H 'content-type: application/json' \
      -H "x-atlas-signature: t=$t,v1=$firma" --data-binary "$cuerpo"
  fi
}
