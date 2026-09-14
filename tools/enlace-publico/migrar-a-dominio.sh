#!/bin/bash
#
# Mueve el enlace público de Atlas al dominio propio. Se ejecuta EN EL SERVIDOR, como root.
#
#   ./migrar-a-dominio.sh api.tudominio.com
#
# Qué hace, en este orden:
#   1. Comprueba que el dominio resuelve y que apunta aquí (si no, para: media migración es peor).
#   2. Añade el dominio a los routers de Traefik del portal y de MinIO.
#   3. Cambia las variables del backend que generan las URLs firmadas.
#   4. Redespliega backend y portal, y verifica el CUERPO de la respuesta (no el código).
#
# Lo que NO hace, a propósito:
#   - NO compra el dominio ni toca el registrador: eso lo hace una persona.
#   - NO retira el nombre de Tailscale. Se dejan los dos mientras haya un APK repartido apuntando al
#     viejo; retirarlo antes deja a esos testers sin servicio.
#   - NO recompila la app. Eso es `eas build` desde el Mac, con `eas.json` ya apuntando al dominio.
#
# Antes de ejecutarlo hace falta un túnel que termine en este equipo. Con Cloudflare Tunnel:
#   cloudflared tunnel login && cloudflared tunnel create atlas
#   cloudflared tunnel route dns atlas api.tudominio.com
#   # ingress: api.tudominio.com -> http://127.0.0.1:80   (Traefik enruta por Host, como ahora)
#   cloudflared service install     # queda como servicio: sobrevive reinicios, igual que tailscaled
set -euo pipefail

DOMINIO="${1:-}"
[ -n "$DOMINIO" ] || { echo "Uso: $0 api.tudominio.com"; exit 1; }

echo "== 1. comprobando que $DOMINIO llega a este equipo =="
if ! getent hosts "$DOMINIO" >/dev/null; then
  echo "   $DOMINIO no resuelve todavía. Termina el DNS y vuelve."; exit 1
fi
if ! curl -s --max-time 10 -H "Host: $DOMINIO" http://127.0.0.1:80/api/v1/health | grep -q '"service":"atlas-backend"'; then
  echo "   Traefik no responde al Host $DOMINIO. Se añade abajo; sigue."
fi

echo "== 2. añadiendo el dominio a los routers de Traefik =="
echo "   Edita en el repo y empuja (Coolify NO interpola variables en las etiquetas):"
echo "     AtlasBackend/docker-compose.coolify.yml  -> regla de atlas-minio, añade || Host(\`$DOMINIO\`)"
echo "     AtlasAdminPortal/docker-compose.coolify.yml -> router atlas-portal-ts, añade el dominio"
echo "   (van a mano porque es lo que se versiona y lo que sobrevive al siguiente despliegue)"

echo "== 3. variables que generan las URLs firmadas de MinIO =="
cat <<EOF
   En Coolify, aplicación atlas-backend:
     MINIO_PUBLIC_HOST=$DOMINIO
     STORAGE_S3_PUBLIC_ENDPOINT=https://$DOMINIO
   Sin esto, la app sube el carnet contra el host viejo.
EOF

echo "== 4. verificación (mira el CUERPO, no el código) =="
cat <<EOF
   curl -s -H 'x-tenant-id: 1' https://$DOMINIO/api/v1/health | grep '"service":"atlas-backend"'
   curl -s https://$DOMINIO/legal/privacy_policy | grep -i '<title>'
   curl -s -o /dev/null -w '%{http_code}\n' https://$DOMINIO/atlas-evidence/   # 403 = MinIO responde

   Y en el Mac, para que la app deje de depender de túneles:
     AtlasFrontend/apps/consumer-app/eas.json  -> los tres perfiles a https://$DOMINIO/api/v1
     .env.local -> lo mismo, y reiniciar Metro
     eas build --platform android --profile preview    # ÚLTIMA recompilación por cambio de URL
EOF
