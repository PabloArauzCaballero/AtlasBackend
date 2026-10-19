# Funciones que quitan ruido a los avisos del monitor. Se cargan con `.` desde monitor.sh (no se ejecutan).
# Medido el 2026-10-19: un Redis en bucle de reinicios mandó ~200 avisos «REINICIO» seguidos, cada uno con el
# contador acumulado, y la entrada de Coolify por SSH saltó como «NUEVA» porque su IP de Docker cambió.

# Un aviso de REINICIO por contenedor y ventana (REINICIO_AVISO_S, 1 h por defecto). Dentro de la ventana los
# reinicios se acumulan en silencio y salen en el siguiente aviso: «sigue reiniciándose: N veces».
# Uso: aviso_reinicio <contenedor> <reinicios_nuevos> <total>. Necesita $E y alertar.
aviso_reinicio() {
  ar_marca="$E/rst-aviso-$1"; ar_acum="$E/rst-acum-$1"
  ar_ahora=$(date +%s); ar_ult=0; ar_n=0
  [ -f "$ar_marca" ] && ar_ult=$(cat "$ar_marca")
  [ -f "$ar_acum" ] && ar_n=$(cat "$ar_acum")
  ar_n=$((ar_n + $2))
  if [ $((ar_ahora - ar_ult)) -lt "${REINICIO_AVISO_S:-3600}" ]; then
    echo "$ar_n" > "$ar_acum"
    return 0
  fi
  echo "$ar_ahora" > "$ar_marca"; echo 0 > "$ar_acum"
  if [ "$ar_ult" -eq 0 ]; then
    alertar "REINICIO: $1 se reinició $ar_n vez/veces (total $3). Mirar docker logs $1."
  else
    alertar "REINICIO: $1 sigue reiniciándose: $ar_n veces desde el último aviso (total $3). Mirar docker logs $1."
  fi
}

# ¿Es Coolify entrando desde una red privada con su propia llave? Coolify administra el host por SSH desde su
# contenedor, cuya IP de Docker (10.0.x.y) cambia en cada redespliegue; reconocerlo por IP daba un aviso falso
# cada vez. Se reconoce por lo que no cambia: origen PRIVADO y una llave de authorized_keys con comentario
# `coolify`. Desde una IP pública no se perdona nunca. Uso: ssh_de_coolify <ip> <huella SHA256:…>.
ssh_de_coolify() {
  case "$1" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
    *) return 1 ;;
  esac
  [ -n "$2" ] || return 1
  ssh-keygen -lf "${SSH_AUTHORIZED_KEYS:-/root/.ssh/authorized_keys}" 2>/dev/null | grep -F "$2" | grep -q ' coolify '
}
