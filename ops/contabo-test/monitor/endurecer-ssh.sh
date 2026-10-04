#!/bin/sh
# Endurece sshd en Contabo con red de seguridad. Lo corre una PERSONA, como root, desde una sesión SSH que
# entró con LLAVE y que NO cierra hasta confirmar:
#
#   sh endurecer-ssh.sh             aplica y programa la reversión automática en 10 min
#   sh endurecer-ssh.sh confirmar   cancela la reversión (sólo después de entrar desde OTRA terminal)
#   sh endurecer-ssh.sh revertir    quita el endurecimiento ya mismo
#
# Qué cambia (un solo archivo, /etc/ssh/sshd_config.d/00-atlas-hardening.conf):
#   PermitRootLogin prohibit-password   root sólo entra con llave
#   PasswordAuthentication no           nadie entra con contraseña
#   LoginGraceTime 30                   2 min -> 30 s para completar el login (menos conexiones colgadas)
# No toca MaxAuthTries: con varias llaves en el agente, bajarlo deja fuera a quien entra legítimamente.
#
# Por qué el archivo se llama 00-: en sshd gana el PRIMER valor que lee, y `50-cloud-init.conf` pone
# `PasswordAuthentication yes` (el `no` de 60-cloudimg-settings.conf nunca llegaba a aplicarse).
#
# Red de seguridad: respaldo de /etc/ssh, `sshd -t` antes de recargar, `reload` (no restart: las sesiones
# abiertas siguen vivas) y reversión automática a los 10 min salvo que se ejecute `confirmar`.
set -eu
DROP=/etc/ssh/sshd_config.d/00-atlas-hardening.conf
UNIDAD=atlas-ssh-reversion
AVISO_MAIL_TO=${AVISO_MAIL_TO:-}; AVISO_MAIL_SECRET=${AVISO_MAIL_SECRET:-}; AVISO_MAIL_URL=${AVISO_MAIL_URL:-}
[ -f /opt/atlas/lib/avisar.sh ] && . /opt/atlas/lib/avisar.sh || avisar() { echo "AVISO: $1"; }

recargar() { sshd -t && systemctl reload ssh; }

case "${1:-aplicar}" in
  confirmar)
    systemctl stop "$UNIDAD.timer" "$UNIDAD.service" 2>/dev/null || true
    echo "Reversión cancelada. El endurecimiento queda aplicado."
    avisar "🔐 SSH endurecido y CONFIRMADO: root sólo con llave y sin contraseñas."
    exit 0 ;;
  revertir)
    systemctl stop "$UNIDAD.timer" "$UNIDAD.service" 2>/dev/null || true
    rm -f "$DROP"; recargar
    echo "Endurecimiento retirado."
    avisar "🔐 SSH: endurecimiento RETIRADO (vuelven las contraseñas y root por contraseña)."
    exit 0 ;;
esac

# 1. Que esta sesión haya entrado con llave: si no, no se aplica (te quedarías sin puerta).
ip=${SSH_CLIENT:-}; ip=${ip%% *}
if [ -z "$ip" ]; then echo "No hay SSH_CLIENT: corre esto desde una sesión SSH, no desde la consola."; exit 1; fi
if ! journalctl -u ssh --no-pager --since "-20min" 2>/dev/null | grep -qE "Accepted publickey for root from $ip "; then
  echo "Esta sesión (desde $ip) no entró con llave en los últimos 20 min. NO se aplica nada."
  echo "Entra con tu llave y vuelve a correr el script."
  exit 1
fi
[ -s /root/.ssh/authorized_keys ] || { echo "authorized_keys está vacío. NO se aplica."; exit 1; }
[ -e "$DROP" ] && { echo "Ya está aplicado ($DROP). Usa 'confirmar' o 'revertir'."; exit 1; }

# 2. Respaldo y archivo.
copia=/root/ssh-antes-$(date +%Y%m%d-%H%M%S)
mkdir -p "$copia"; cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.d "$copia/"
cat > "$DROP" <<'EOF'
# Atlas: endurecimiento de SSH (2026-10-04). Lleva 00- para ganar a 50-cloud-init.conf (gana el primer valor).
# Se retira con: sh endurecer-ssh.sh revertir
PermitRootLogin prohibit-password
PasswordAuthentication no
LoginGraceTime 30
EOF
chmod 644 "$DROP"

# 3. Probar antes de recargar; si falla, se deja todo como estaba.
if ! sshd -t; then rm -f "$DROP"; echo "sshd -t rechazó la configuración. Todo como estaba."; exit 1; fi
efectivo=$(sshd -T | grep -E '^(permitrootlogin|passwordauthentication|logingracetime) ' | tr '\n' ' ')
echo "Configuración efectiva: $efectivo"
case "$efectivo" in *"passwordauthentication no"*) ;; *) rm -f "$DROP"; echo "La contraseña seguiría activa: algo la pisa. Todo como estaba."; exit 1 ;; esac

# 4. Reversión automática en 10 min, y recarga.
systemd-run --quiet --unit="$UNIDAD" --on-active=600 --collect /bin/sh -c \
  "rm -f $DROP; sshd -t && systemctl reload ssh; logger -t atlas-aviso 'SSH: endurecimiento REVERTIDO por falta de confirmación'"
recargar
avisar "🔐 SSH: endurecimiento APLICADO (root sólo con llave, sin contraseñas). Se revierte solo en 10 min si no lo confirmas."

cat <<EOF

APLICADO. NO cierres esta sesión.
  1) Abre OTRA terminal y entra:   ssh root@161.97.85.216 true     (tiene que funcionar con tu llave)
  2) Comprueba que la contraseña ya no vale:
       ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password root@161.97.85.216
     debe contestar "Permission denied (publickey)".
  3) Si el paso 1 funcionó, en esta sesión:   sh $0 confirmar
Si no confirmas, en 10 minutos se revierte solo. Respaldo de la configuración anterior: $copia
EOF
