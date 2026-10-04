#!/bin/sh
# Poda manual de la caché de build (la lanza /podar confirmar en una unidad systemd aparte).
# Misma poda que la automática del monitor: conserva CACHE_KEEP_GB, nunca -a ni system prune.
AVISO_MAIL_TO=${AVISO_MAIL_TO:-}; AVISO_MAIL_SECRET=${AVISO_MAIL_SECRET:-}; AVISO_MAIL_URL=${AVISO_MAIL_URL:-}
. /opt/atlas/lib/avisar.sh
[ -f /opt/atlas/monitor/monitor.env ] && . /opt/atlas/monitor/monitor.env
KEEP=${CACHE_KEEP_GB:-100}
E=/var/lib/atlas-monitor
gb() { docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | grep '^Build Cache|' | cut -d'|' -f2 |
  awk '{n=$1+0; if($1~/TB/)n*=1024; else if($1~/MB/)n/=1024; else if($1~/kB/)n/=1048576; printf "%d", n}'; }
antes=$(gb)
docker builder prune -f --reserved-space "${KEEP}GB" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  despues=$(gb); echo "$despues" > "$E/cache_gb"
  avisar "🧹 Poda manual terminada: la caché de build baja de ${antes} GB a ${despues} GB."
else
  avisar "🔴 La poda manual de la caché de build FALLÓ (${antes} GB). Mirar a mano: docker builder prune --reserved-space."
fi
