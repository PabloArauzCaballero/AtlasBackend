#!/usr/bin/env bash
# ============================================================================
# Atlas · restauración de una copia de PostgreSQL
# ============================================================================
#
# La mitad que casi nunca se escribe. Una copia sin procedimiento de vuelta es un archivo que nadie
# sabe usar el día que hace falta, y ese día no es el día de aprender.
#
# Uso:
#   PGPASSWORD=... ops/postgres/restore.sh backups/atlas-20260914T020000Z.dump atlas_restaurada
#
# El segundo argumento es la base DESTINO y es obligatorio: restaurar encima de la base que está
# sirviendo tiene que ser una decisión escrita a mano, no el valor por omisión de un guion.
#
# Después de restaurar hay que volver a aplicar los privilegios: el volcado se hace con
# `--no-owner --no-privileges`, así que los roles de mínimo privilegio no viajan dentro.
#
#   psql -d <destino> -v DBNAME=<destino> -f ops/postgres/grants.sql
#   DB_NAME=<destino> yarn db:grants:apply
#
# Y comprobarlo:  DB_NAME=<destino> yarn check:db-privileges
# ============================================================================
set -euo pipefail

archivo="${1:-}"
destino="${2:-}"

if [ -z "$archivo" ] || [ -z "$destino" ]; then
  echo "Uso: $0 <archivo.dump> <base-destino>" >&2
  echo "     La base destino es obligatoria a propósito: no hay valor por omisión." >&2
  exit 2
fi

if [ ! -f "$archivo" ]; then
  echo "[restore] ❌ No existe el archivo: ${archivo}" >&2
  exit 1
fi

# Integridad antes de tocar nada: si el volcado viajó mal, es mejor saberlo antes de crear la base.
if [ -f "${archivo}.sha256" ]; then
  echo "[restore] comprobando huella…"
  if command -v sha256sum > /dev/null 2>&1; then
    (cd "$(dirname "$archivo")" && sha256sum --check --status "$(basename "${archivo}.sha256")")
  else
    (cd "$(dirname "$archivo")" && shasum -a 256 --check --status "$(basename "${archivo}.sha256")")
  fi
  echo "[restore] huella correcta."
else
  echo "[restore] ⚠️  sin .sha256 al lado: no se puede comprobar que el archivo llegó entero."
fi

if ! pg_restore --list "$archivo" > /dev/null; then
  echo "[restore] ❌ El volcado no se puede leer." >&2
  exit 1
fi

existe="$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${destino}'" postgres || true)"
if [ "$existe" = "1" ]; then
  echo "[restore] ❌ La base '${destino}' YA EXISTE." >&2
  echo "         Este guion no borra bases. Elige otro nombre, o bórrala a mano si de verdad quieres" >&2
  echo "         perder lo que tiene: dropdb '${destino}'" >&2
  exit 1
fi

echo "[restore] creando ${destino}…"
createdb "$destino"

echo "[restore] restaurando (los errores de objetos que ya existen se ignoran a propósito)…"
pg_restore \
  --dbname="$destino" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$archivo"

tablas="$(psql -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'" "$destino")"
echo "[restore] ✅ ${destino} restaurada con ${tablas} tablas."
echo "[restore] SIGUIENTE PASO obligatorio — los privilegios NO viajan en el volcado:"
echo "          psql -d ${destino} -v DBNAME=${destino} -f ops/postgres/grants.sql"
echo "          DB_NAME=${destino} yarn db:grants:apply"
echo "          DB_NAME=${destino} yarn check:db-privileges"
