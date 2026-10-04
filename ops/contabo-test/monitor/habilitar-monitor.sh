#!/bin/sh
# Habilita el resumen de monitoreo de AtlasBackend en TEST. Lo corre una PERSONA en Contabo, como root:
#   ssh root@161.97.85.216 'sh /root/monitor-src/habilitar-monitor.sh'
#
# Es configuración compartida del host (una variable de la app 1 en Coolify), por eso no lo hace Claude.
# Qué hace:
#   1. Genera CONTEXT_SERVICE_TOKEN_SECRET con openssl (no se imprime) y lo guarda en
#      /opt/atlas/monitor/monitor.env (600) junto con el tenant y el emisor JWT de la API.
#   2. Crea esa variable en Coolify para AtlasBackend (app 1): la API, el worker y el messaging-worker
#      la leen del mismo compose. Entra en vigor en el SIGUIENTE despliegue de AtlasBackend.
#   3. No redespliega nada.
# Efecto colateral que conviene saber: esa variable también enciende el directorio de destinatarios entre
# contextos, que hoy responde 503 en TEST por falta de secreto (el messaging-worker lo consulta).
# Idempotente: si ya existe, no crea otra ni cambia el secreto.
set -eu
ENV=/opt/atlas/monitor/monitor.env
mkdir -p /opt/atlas/monitor
touch "$ENV"; chmod 600 "$ENV"

api=$(docker ps -q --filter label=coolify.applicationId=1 --filter label=com.docker.compose.service=api --filter status=running | head -n 1)
[ -n "$api" ] || { echo "No hay API de AtlasBackend en marcha: no se puede leer su emisor JWT."; exit 1; }
tenant=$(docker exec atlas-postgres psql -U postgres -d atlas -Atc "select id from iam.tenants order by id limit 1")
issuer=$(docker exec "$api" printenv JWT_ISSUER || true)
[ -n "$tenant" ] || { echo "No se encontró el tenant."; exit 1; }

if grep -q '^CONTEXT_SERVICE_TOKEN_SECRET=.' "$ENV"; then
  echo "El secreto ya estaba en monitor.env: se conserva."
else
  secreto=$(openssl rand -hex 32)
  tmp=$(mktemp); chmod 600 "$tmp"
  grep -vE '^(CONTEXT_SERVICE_TOKEN_SECRET|MONITOR_TENANT_ID|JWT_ISSUER)=' "$ENV" > "$tmp" || true
  {
    printf 'CONTEXT_SERVICE_TOKEN_SECRET=%s\n' "$secreto"
    printf 'MONITOR_TENANT_ID=%s\n' "$tenant"
    printf 'JWT_ISSUER=%s\n' "$issuer"
  } >> "$tmp"
  mv "$tmp" "$ENV"
fi

# Coolify: la variable se cifra con la clave de la instalación, así que se crea con su propio PHP.
S=$(grep '^CONTEXT_SERVICE_TOKEN_SECRET=' "$ENV" | cut -d= -f2-) \
  docker exec -e S coolify php artisan tinker --execute='
$app = App\Models\Application::find(1);
$ya = $app->environment_variables()->where("key", "CONTEXT_SERVICE_TOKEN_SECRET")->where("is_preview", false)->exists();
if ($ya) { echo "Coolify ya tenía CONTEXT_SERVICE_TOKEN_SECRET: sin cambios.\n"; }
else {
  $app->environment_variables()->create(["key" => "CONTEXT_SERVICE_TOKEN_SECRET", "value" => getenv("S"), "is_preview" => false, "is_runtime" => true, "is_buildtime" => false, "is_literal" => true]);
  echo "Variable creada en Coolify para AtlasBackend.\n";
}'
echo "Hecho. Entra en vigor en el próximo despliegue de AtlasBackend (el monitor la usa desde entonces)."
