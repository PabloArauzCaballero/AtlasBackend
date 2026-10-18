#!/bin/sh
# Siembra la cartera de ejemplo en TEST (Contabo) y le da historia en la base de tableros.
#
#   sh scripts/cartera-ejemplo/cargar-en-test.sh            # siembra (idempotente)
#   sh scripts/cartera-ejemplo/cargar-en-test.sh --quitar   # la retira de las dos bases
#
# Antes de tocar nada deja un respaldo de las tablas afectadas en el propio servidor
# (/opt/atlas/respaldos), así que ningún dato sale de TEST. Ver README.md de esta carpeta.
set -eu

HOST="${ATLAS_TEST_SSH:-root@161.97.85.216}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL_CORE="docker exec -i atlas-postgres psql -U postgres -d atlas -v ON_ERROR_STOP=1 -q"
PSQL_TABLEROS="docker exec -i atlas-postgres psql -U postgres -d atlas_dashboards -v ON_ERROR_STOP=1 -q"

QUITAR_HISTORIA="DELETE FROM dashboards.loan_daily_snapshot WHERE es_semilla AND product_code LIKE 'DEMO-%';
DELETE FROM dashboards.portfolio_snapshot_daily WHERE es_semilla AND product_code LIKE 'DEMO-%';"

respaldo() {
  marca="$(date -u +%Y%m%dT%H%M%SZ)"
  echo "Respaldo previo en el servidor: /opt/atlas/respaldos/cartera-ejemplo-$marca-*.dump"
  ssh -o BatchMode=yes "$HOST" "mkdir -p /opt/atlas/respaldos && \
    docker exec atlas-postgres pg_dump -U postgres -d atlas -Fc -n credit -t customer.customers -t partner.partner_profiles \
      > /opt/atlas/respaldos/cartera-ejemplo-$marca-atlas.dump && \
    docker exec atlas-postgres pg_dump -U postgres -d atlas_dashboards -Fc -t dashboards.loan_daily_snapshot -t dashboards.portfolio_snapshot_daily \
      > /opt/atlas/respaldos/cartera-ejemplo-$marca-tableros.dump"
}

if [ "${1:-}" = "--quitar" ]; then
  respaldo
  echo "$QUITAR_HISTORIA" | ssh -o BatchMode=yes "$HOST" "$PSQL_TABLEROS"
  ssh -o BatchMode=yes "$HOST" "$PSQL_CORE" < "$DIR/quitar.sql"
  echo "Cartera de ejemplo retirada de atlas y atlas_dashboards."
  exit 0
fi

respaldo

echo "1/2 · Cartera en el núcleo (atlas)"
ssh -o BatchMode=yes "$HOST" "$PSQL_CORE -v permitir=si" < "$DIR/sembrar.sql"

echo "2/2 · Historia en la base de tableros (atlas_dashboards)"
# Un solo flujo: la cabecera abre la transacción y el COPY, siguen las filas que salen del núcleo,
# y el pie rehace la foto agregada por producto y tramo desde la foto por préstamo.
{
  printf '%s\n' "BEGIN;" "$QUITAR_HISTORIA" \
    "COPY dashboards.loan_daily_snapshot (tenant_id, at, loan_ref, product_code, cohort, bucket, days_past_due, saldo_capital, paid_principal, paid_interest, written_off, es_semilla) FROM STDIN WITH (FORMAT csv);"
  ssh -o BatchMode=yes "$HOST" "docker exec -i atlas-postgres psql -U postgres -d atlas -v ON_ERROR_STOP=1 -q" < "$DIR/historia-prestamos.sql"
  printf '%s\n' '\.'
  cat "$DIR/historia-cartera.sql"
  printf '%s\n' "COMMIT;"
} | ssh -o BatchMode=yes "$HOST" "$PSQL_TABLEROS"

echo "Hecho. La foto de hoy de los KPI se rehace en la próxima corrida del job de tableros."
