#!/usr/bin/env bash
# ============================================================================
# Atlas · copia de seguridad de PostgreSQL, con verificación
# ============================================================================
#
# El repositorio no tenía NINGÚN procedimiento de copia: ni guion, ni retención, ni forma de saber si
# lo copiado sirve. Una copia que nadie ha intentado restaurar no es una copia, es un archivo.
#
# Qué hace, en este orden:
#   1. `pg_dump` en formato custom (comprimido, restaurable por partes, paralelizable).
#   2. VERIFICA el volcado leyendo su tabla de contenidos con `pg_restore --list`. Un volcado
#      truncado —disco lleno, red cortada— pasa el `pg_dump` con código 0 y falla aquí.
#   3. Escribe un `.sha256` al lado: es lo que permite detectar corrupción en el destino después.
#   4. Borra las copias más viejas que `ATLAS_BACKUP_RETENTION_DAYS`.
#
# Uso:
#   PGPASSWORD=... ops/postgres/backup.sh
#
# Variables (todas con valor por omisión salvo las de conexión):
#   PGHOST PGPORT PGUSER PGDATABASE   estándar de libpq; la contraseña NUNCA se pasa por argumento
#   ATLAS_BACKUP_DIR                  destino (por omisión ./backups)
#   ATLAS_BACKUP_RETENTION_DAYS       días a conservar (por omisión 14)
#   ATLAS_BACKUP_JOBS                 paralelismo de pg_dump (por omisión 2)
#
# Lo que este guion NO decide y hay que acordar: cada cuánto corre, a qué destino REMOTO se copia
# después (un volcado en el mismo disco que la base no sobrevive al incidente que importa), cuánto
# se tolera perder (RPO) y en cuánto hay que estar de vuelta (RTO). Ver el runbook de recuperación.
# ============================================================================
set -euo pipefail

destino="${ATLAS_BACKUP_DIR:-./backups}"
retencion="${ATLAS_BACKUP_RETENTION_DAYS:-14}"
paralelo="${ATLAS_BACKUP_JOBS:-2}"
base="${PGDATABASE:-atlas}"
marca="$(date -u +%Y%m%dT%H%M%SZ)"
archivo="${destino}/${base}-${marca}.dump"

mkdir -p "$destino"

echo "[backup] base=${base} host=${PGHOST:-localhost}:${PGPORT:-5432} → ${archivo}"

# `--no-owner` y `--no-privileges`: los roles y los grants los crea `bootstrap-roles.sql` +
# `apply-grants`, no el volcado. Restaurar la propiedad de una base a otra instalación es la forma
# más rápida de terminar con objetos de un rol que allí no existe.
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$archivo" \
  "$base"

# Verificación: si el volcado está truncado, esto falla. Sin este paso, el fallo se descubriría el
# día de la restauración, que es el único día en que no se puede permitir.
if ! pg_restore --list "$archivo" > /dev/null; then
  echo "[backup] ❌ El volcado no se puede leer: se descarta." >&2
  rm -f "$archivo"
  exit 1
fi

entradas="$(pg_restore --list "$archivo" | grep -c '^[0-9]' || true)"
if [ "$entradas" -lt 50 ]; then
  echo "[backup] ❌ El volcado sólo tiene ${entradas} objetos: eso no es esta base. Se descarta." >&2
  rm -f "$archivo"
  exit 1
fi

if command -v sha256sum > /dev/null 2>&1; then
  sha256sum "$archivo" > "${archivo}.sha256"
else
  shasum -a 256 "$archivo" > "${archivo}.sha256"
fi

tamano="$(du -h "$archivo" | cut -f1)"
echo "[backup] ✅ ${archivo} (${tamano}, ${entradas} objetos) verificado."

# Retención. `-mtime +N` borra lo más viejo que N días; nunca toca el volcado recién creado.
borradas="$(find "$destino" -maxdepth 1 -name "${base}-*.dump" -mtime "+${retencion}" -print -delete | wc -l | tr -d ' ')"
find "$destino" -maxdepth 1 -name "${base}-*.dump.sha256" -mtime "+${retencion}" -delete
echo "[backup] retención ${retencion} días: ${borradas} copias retiradas."

echo "[backup] RECORDATORIO: esta copia está en el MISMO disco que la base. Cópiala fuera."
