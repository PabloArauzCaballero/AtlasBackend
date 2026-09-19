#!/bin/sh
# Comprueba de PUNTA A PUNTA que una traza real llega a Jaeger.
#
# No comprueba que Jaeger responda —eso lo hace el healthcheck del contenedor—, sino que ESTE
# backend exporta: arranca el SDK, abre un span con un nombre irrepetible, lo vacía, y lo busca en
# la API de Jaeger hasta encontrarlo. Un fallo aquí significa que la cadena está rota en algún
# punto entre el proceso y el almacén, que es justo lo que ningún «verde» de compilación ve.
#
#   yarn jaeger:up && yarn jaeger:verify
#
# Sólo usa `docker`, `node` y `curl`: nada que haya que instalar aparte.
set -eu

JAEGER_UI="${JAEGER_UI:-http://127.0.0.1:16686}"
OTLP="${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:-http://127.0.0.1:4318/v1/traces}"
SERVICIO="${OTEL_SERVICE_NAME:-atlas-verify}"
INTENTOS="${VERIFY_ATTEMPTS:-20}"

fallar() { printf '\n❌ %s\n' "$1" >&2; exit 1; }

printf '1/5 Jaeger responde en %s … ' "$JAEGER_UI"
curl -fsS --max-time 5 "$JAEGER_UI/api/services" >/dev/null 2>&1 \
  || fallar "Jaeger no responde en $JAEGER_UI. Levántalo con 'yarn jaeger:up' y reintenta."
printf 'sí\n'

command -v node >/dev/null 2>&1 || fallar "Hace falta node en el PATH."
[ -d node_modules/@opentelemetry/sdk-node ] || fallar "Faltan dependencias: corre 'yarn install'."

printf '2/5 Exportando una traza de prueba … '
OPERACION="verify.jaeger"
# Se ejecuta el FUENTE con tsx, no `dist/`: así la comprobación no depende de que alguien haya
# construido antes, y los builds no tienen que tocar el árbol compartido.
TRACE_ID=$(
  OTEL_ENABLED=true \
  OTEL_SERVICE_NAME="$SERVICIO" \
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="$OTLP" \
  OTEL_TRACES_SAMPLER_ARG=1.0 \
  VERIFY_OPERATION="$OPERACION" \
  npx tsx scripts/emit-verification-span.ts 2>/dev/null
) || fallar "No se pudo exportar la traza de prueba. Revisa la salida de 'npx tsx scripts/emit-verification-span.ts'."

case "$TRACE_ID" in
  [0-9a-f]*) [ "${#TRACE_ID}" -eq 32 ] || fallar "trace_id con formato inesperado: '$TRACE_ID'" ;;
  *) fallar "No se obtuvo un trace_id; salida: '$TRACE_ID'" ;;
esac
printf 'trace_id=%s\n' "$TRACE_ID"

printf '3/5 El servicio "%s" aparece en Jaeger … ' "$SERVICIO"
i=0
while [ "$i" -lt "$INTENTOS" ]; do
  # La exportación es asíncrona y por lotes: aparecer no es instantáneo, y reintentar es correcto.
  if curl -fsS --max-time 5 "$JAEGER_UI/api/services" | grep -q "\"$SERVICIO\""; then break; fi
  i=$((i + 1)); sleep 1
done
[ "$i" -lt "$INTENTOS" ] || fallar "El servicio no aparece tras ${INTENTOS}s. Revisa OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ($OTLP)."
printf 'sí\n'

printf '4/5 La traza %s existe y trae su span … ' "$TRACE_ID"
i=0
CUERPO=''
while [ "$i" -lt "$INTENTOS" ]; do
  CUERPO=$(curl -fsS --max-time 5 "$JAEGER_UI/api/traces/$TRACE_ID" 2>/dev/null || printf '')
  # Se mira el CONTENIDO, no el código HTTP: Jaeger devuelve 200 con `data: []` para una traza
  # que no conoce, y darlo por bueno sería exactamente el verde que miente.
  case "$CUERPO" in *"\"operationName\":\"$OPERACION\""*) break ;; esac
  i=$((i + 1)); sleep 1
done
case "$CUERPO" in
  *"\"operationName\":\"$OPERACION\""*) printf 'sí\n' ;;
  *) fallar "La traza no contiene el span '$OPERACION' tras ${INTENTOS}s. Respuesta: $(printf '%.200s' "$CUERPO")" ;;
esac

printf '5/5 Sin datos sensibles en la traza … '
for PROHIBIDO in authorization cookie x-api-key password token; do
  case "$(printf '%s' "$CUERPO" | tr 'A-Z' 'a-z')" in
    *"$PROHIBIDO"*) fallar "La traza contiene «$PROHIBIDO». Ver docs/observability/04-data-privacy-policy.md." ;;
  esac
done
printf 'sí\n'

printf '\n✅ La cadena completa funciona: proceso → OTLP → Jaeger.\n'
printf '   Ábrela en %s/trace/%s\n' "$JAEGER_UI" "$TRACE_ID"
