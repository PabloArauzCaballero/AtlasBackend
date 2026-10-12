# Sondas de EXTREMO A EXTREMO, por la misma ruta pública que usa la app (se carga desde monitor.sh).
#
# Por qué existen: el monitor sólo miraba contenedores sanos. El 2026-10-06 la app de TestFlight
# (que apunta a DEV por el enlace público de Tailscale) se quedó en «Sin conexión» mientras DEV se
# redesplegaba, y ningún contenedor de TEST estaba mal: nadie avisó. Aquí se pide lo que pide la app
# y se mira el CUERPO, no el código (un 200 puede ser el HTML de otro proyecto).
#
# Coste: 3 GET pequeños cada 2 minutos. Aviso tras 2 lecturas malas seguidas (~4 min): un redespliegue
# normal de DEV tarda ~80 s y no debe sonar; una caída de verdad sí.
[ $(( $(date +%M | sed 's/^0//') % 2 )) -eq 0 ] || return 0

# sonda clave nombre url cabecera_tenant patron
sonda() {
  cuerpo=$(curl -s -m 12 -H 'x-tenant-id: 1' "$3" 2>/dev/null | head -c 4000)
  case "$cuerpo" in *"$4"*) malo=0 ;; *) malo=1 ;; esac
  chequeo "sonda-$1" "$malo" 2 \
    "$2 NO responde bien por la ruta pública que usa la app ($3). Si la app dice «Sin conexión», es esto. Mira /estado y la cola de Coolify del H310." \
    "$2 vuelve a responder por la ruta pública."
}

sonda dev-contenido "DEV (H310)" "https://pablo-h310.taila8f993.ts.net/api/v1/app-content?surface=legal" '"contentKey"'
sonda test-contenido "TEST (Contabo)" "http://161.97.85.216/api/v1/app-content?surface=legal" '"contentKey"'
sonda test-app "TEST web de la app" "http://161.97.85.216/app/" '<title>Atlas'
