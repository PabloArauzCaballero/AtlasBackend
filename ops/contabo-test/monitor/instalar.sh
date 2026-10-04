#!/bin/sh
# Instala el informador en Contabo (como root, desde esta carpeta copiada al servidor).
# Requiere /opt/atlas/lib/avisar.sh y avisar.env (Telegram). No toca Traefik ni Coolify.
set -eu
mkdir -p /opt/atlas/monitor /var/lib/atlas-monitor
install -m 755 monitor.sh grafico.py comandos.sh podar.sh ssh.sh /opt/atlas/monitor/
[ -f /opt/atlas/monitor/monitor.env ] || { umask 077; : > /opt/atlas/monitor/monitor.env; }
install -m 644 atlas-monitor.service atlas-monitor.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now atlas-monitor.timer
systemctl list-timers atlas-monitor.timer --no-pager | head -3
