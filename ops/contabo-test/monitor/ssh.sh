# Vigilancia de la puerta SSH de Contabo. La carga monitor.sh y llama a `vigilar_ssh` en cada pasada.
#
# SÓLO LEE: el journal de sshd, fail2ban y dos ficheros. No cambia ninguna configuración de SSH.
# Contexto medido el 2026-10-04: ~6.400 intentos fallidos al día (1.800 contra root), fail2ban activo con
# 1.700 bloqueos acumulados, `PermitRootLogin yes` y `PasswordAuthentication yes`, ufw inactivo. El ruido de
# fuerza bruta es constante y fail2ban lo contiene; lo que hay que ver es lo que NO es ruido:
#
#   1. Una entrada exitosa desde una IP que no conocemos (o con contraseña, o tras muchos fallos de esa IP).
#   2. Un pico de intentos (≈7 veces lo normal) en 5 minutos.
#   3. fail2ban parado.
#   4. Que cambien las llaves autorizadas (authorized_keys) o la configuración efectiva de sshd.
#
# Los avisos de seguridad usan `avisar` directamente: /silenciar NO los calla.
SSH_CONOCIDAS=${SSH_CONOCIDAS:-/opt/atlas/monitor/ssh-conocidas.txt}
SSH_PICO_5MIN=${SSH_PICO_5MIN:-150}

vigilar_ssh() {
  ahora_s=$(date +%s)
  desde=$ahora_s; [ -f "$E/ssh.ult" ] && desde=$(cat "$E/ssh.ult")
  # Tras una pasada larga (una poda tarda minutos) se mira como mucho 15 min atrás.
  [ $((ahora_s - desde)) -gt 900 ] && desde=$((ahora_s - 900))
  echo "$ahora_s" > "$E/ssh.ult"
  journalctl -u ssh --no-pager -o short-unix --since "@$desde" 2>/dev/null > "$E/ssh.log" || : > "$E/ssh.log"
  touch "$SSH_CONOCIDAS" "$E/ssh-vistas"

  # Fallos de la ventana: por IP (última hora) y total (pico de 5 min).
  grep -E "Failed password|Invalid user|authentication failure|Connection closed by authenticating user" "$E/ssh.log" |
    awk '{ ts = int($1); if (match($0, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)) print ts, substr($0, RSTART, RLENGTH); else print ts, "ipv6" }' >> "$E/ssh-fallos.tsv"
  tail -n 4000 "$E/ssh-fallos.tsv" | awk -v c=$((ahora_s - 3600)) '$1 >= c' > "$E/ssh-fallos.n"; mv "$E/ssh-fallos.n" "$E/ssh-fallos.tsv"
  ult5=$(awk -v c=$((ahora_s - 300)) '$1 >= c' "$E/ssh-fallos.tsv" | wc -l)

  # 1. Entradas exitosas.
  grep -E "sshd\[[0-9]+\]: Accepted (publickey|password) for " "$E/ssh.log" | while read -r linea; do
    metodo=$(printf '%s' "$linea" | sed -E 's/.*Accepted ([a-z]+) for.*/\1/')
    usuario=$(printf '%s' "$linea" | sed -E 's/.*Accepted [a-z]+ for ([^ ]+) from.*/\1/')
    ip=$(printf '%s' "$linea" | sed -E 's/.*from ([0-9a-fA-F.:]+) port.*/\1/')
    huella=$(printf '%s' "$linea" | grep -oE "SHA256:[A-Za-z0-9+/]+" | head -1 | cut -c1-20)
    if ! grep -qxF "$ip" "$SSH_CONOCIDAS" && ! grep -qxF "$ip" "$E/ssh-vistas"; then
      echo "$ip" >> "$E/ssh-vistas"
      avisar "🔐 SSH: entrada NUEVA como $usuario desde $ip ($metodo${huella:+, llave $huella}). Si no eres tú ni nadie de tu equipo, revisa authorized_keys y cambia las claves. Para darla por conocida: añádela a $SSH_CONOCIDAS."
    fi
    if [ "$metodo" = password ]; then
      marca="$E/ssh-pass-$ip-$(date +%Y%m%d)"
      [ -f "$marca" ] || { : > "$marca"; avisar "🔐 SSH: entrada con CONTRASEÑA como $usuario desde $ip. Las llaves no se adivinan; una contraseña sí. Recomendado: desactivar PasswordAuthentication."; }
    fi
    previos=$(awk -v ip="$ip" '$2 == ip' "$E/ssh-fallos.tsv" | wc -l)
    if [ "$previos" -ge 5 ]; then
      marca="$E/ssh-tras-fallos-$ip-$(date +%Y%m%d%H)"
      [ -f "$marca" ] || { : > "$marca"; avisar "🚨 SSH: entró $usuario desde $ip, que falló $previos veces en la última hora. Posible fuerza bruta lograda: cambia claves y revisa ya."; }
    fi
  done
  rm -f "$E"/ssh-pass-*-"$(date -d yesterday +%Y%m%d)" 2>/dev/null

  # 2. Pico de intentos.
  chequeo ssh-pico "$([ "$ult5" -ge "$SSH_PICO_5MIN" ] && echo 1 || echo 0)" 1 \
    "🔐 SSH: $ult5 intentos fallidos en 5 min (lo normal son ~20). Ataque más fuerte de lo habitual; fail2ban los va bloqueando." \
    "los intentos de SSH vuelven al nivel normal."

  # 3. fail2ban.
  chequeo ssh-fail2ban "$(systemctl is-active --quiet fail2ban && echo 0 || echo 1)" 2 \
    "🔐 SSH: fail2ban está PARADO. Sin él la puerta 22 queda sin freno a la fuerza bruta." \
    "fail2ban vuelve a estar activo."

  # 4. Deriva: llaves autorizadas y configuración efectiva de sshd.
  huella_llaves=$(sha256sum /root/.ssh/authorized_keys 2>/dev/null | cut -c1-16)
  cfg=$(sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|allowgroups|maxauthtries) ' | sha256sum | cut -c1-16)
  if [ -f "$E/ssh.base-llaves" ] && [ "$(cat "$E/ssh.base-llaves")" != "$huella_llaves" ]; then
    avisar "🔐 SSH: authorized_keys CAMBIÓ (ahora $(wc -l < /root/.ssh/authorized_keys) llaves). Si no fue cosa tuya o de tu equipo, es una puerta trasera."
  fi
  if [ -f "$E/ssh.base-cfg" ] && [ "$(cat "$E/ssh.base-cfg")" != "$cfg" ]; then
    avisar "🔐 SSH: la configuración efectiva de sshd CAMBIÓ (root login: $(sshd -T 2>/dev/null | awk '/^permitrootlogin/{print $2}'), contraseñas: $(sshd -T 2>/dev/null | awk '/^passwordauthentication/{print $2}'))."
  fi
  echo "$huella_llaves" > "$E/ssh.base-llaves"; echo "$cfg" > "$E/ssh.base-cfg"
}
