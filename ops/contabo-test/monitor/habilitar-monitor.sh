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

# Coolify 4.4.2 sólo pone `coolify.applicationUuid`; las de antes, sólo `coolify.applicationId`.
uuid=$(docker exec coolify-db psql -U coolify -d coolify -Atc "select uuid from applications where id=1")
api=$( { docker ps -q --filter label=coolify.applicationId=1 --filter label=com.docker.compose.service=api --filter status=running
         docker ps -q --filter "label=coolify.applicationUuid=$uuid" --filter label=com.docker.compose.service=api --filter status=running; } | head -n 1)
[ -n "$api" ] || { echo "No hay API de AtlasBackend en marcha: no se puede leer su emisor JWT."; exit 1; }
tenant=$(docker exec atlas-postgres psql -U postgres -d atlas -Atc "select _id from iam.tenants order by _id limit 1")
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
    # Entre comillas: el emisor de TEST vale literalmente «Falta JWT_ISSUER» (con espacio) y sin ellas `. monitor.env` rompe.
    printf "JWT_ISSUER='%s'\n" "$issuer"
  } >> "$tmp"
  mv "$tmp" "$ENV"
fi

# Coolify: la variable se cifra con la clave de la instalación, así que se escribe con su propio PHP.
# Coolify YA registra la variable vacía al leer el compose (`${CONTEXT_SERVICE_TOKEN_SECRET:-}`): por eso no basta
# con mirar si existe; si está vacía se rellena, y se le quita la marca de build (un secreto no va como build-arg).
S=$(grep '^CONTEXT_SERVICE_TOKEN_SECRET=' "$ENV" | cut -d= -f2-) \
  docker exec -e S coolify php artisan tinker --execute='
$app = App\Models\Application::find(1);
$v = $app->environment_variables()->where("key", "CONTEXT_SERVICE_TOKEN_SECRET")->where("is_preview", false)->first();
if ($v && strlen((string) $v->value) > 0) { echo "Coolify ya tenía el secreto con valor: sin cambios.\n"; }
elseif ($v) { $v->value = getenv("S"); $v->is_runtime = true; $v->is_buildtime = false; $v->save(); echo "Secreto escrito en la variable existente de Coolify.\n"; }
else { $app->environment_variables()->create(["key" => "CONTEXT_SERVICE_TOKEN_SECRET", "value" => getenv("S"), "is_preview" => false, "is_runtime" => true, "is_buildtime" => false, "is_literal" => true]); echo "Variable creada en Coolify para AtlasBackend.\n"; }'
echo "Hecho. Entra en vigor en el próximo despliegue de AtlasBackend (el monitor la usa desde entonces)."
