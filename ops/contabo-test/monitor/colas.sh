# Colas de revisión HUMANA que nadie está mirando (se carga desde monitor.sh).
#
# Por qué existe: el 2026-10-15 Pablo subió un extracto, la app decía «en revisión» y en el portal del Motor
# no había nada que revisar. Había DOS extractos en `PENDING_REVIEW` (UNKNOWN_BANK) desde el 2026-10-07: el Motor
# los deja en la bandeja del procesador de extractos (Procesadores automáticos → Extractos bancarios), no en
# «Revisión manual», y el backend sólo escribía «2 revisión(es) a punto de vencer» en su log. Ocho días sin que
# nadie lo supiera. Aquí se cuenta en las dos bases y se avisa por Telegram.
#
# Coste: dos COUNT cada 10 minutos. Sólo se leen conteos y fechas, ningún dato de personas.
[ $(( $(date +%M | sed 's/^0//') % 10 )) -eq 0 ] || return 0

pg() { docker exec atlas-postgres psql -U postgres -d "$1" -Atc "$2" 2>/dev/null; }

# El Motor: extractos que esperan a una persona hace más de 24 h.
motor=$(pg atlas_decision "select count(*)||'|'||coalesce(to_char(min(coalesce(review_opened_at, queued_at)) at time zone 'America/La_Paz','DD/MM HH24:MI'),'') from public.decision_bank_statement_run where status in ('PENDING_REVIEW','IN_REVIEW') and coalesce(review_opened_at, queued_at) < now() - interval '24 hours'")
n_motor=${motor%%|*}; desde_motor=${motor#*|}
case "$n_motor" in ''|*[!0-9]*) n_motor=0 ;; esac
chequeo "cola-extractos-motor" "$([ "$n_motor" -gt 0 ] && echo 1 || echo 0)" 1 \
  "$n_motor extracto(s) bancario(s) llevan más de 24 h esperando revisión humana en el Motor (el más antiguo desde $desde_motor). NO salen en «Revisión manual»: Motor → Procesadores automáticos → Extractos bancarios → pestaña de revisión. El cliente ve «en revisión» mientras tanto." \
  "Ya no quedan extractos esperando revisión humana más de 24 h en el Motor."

# El backend: revisiones con el plazo prometido al cliente vencido (cubre también el Motor caído o con la llave mal,
# que deja el extracto en `received` sin llegar nunca a la bandeja del Motor).
core=$(pg atlas "select count(*)||'|'||coalesce(to_char(min(promised_by) at time zone 'America/La_Paz','DD/MM HH24:MI'),'') from credit.bank_statement_reviews where _deleted = false and status in ('received','processing') and promised_by < now()")
n_core=${core%%|*}; desde_core=${core#*|}
case "$n_core" in ''|*[!0-9]*) n_core=0 ;; esac
chequeo "plazo-extractos" "$([ "$n_core" -gt 0 ] && echo 1 || echo 0)" 1 \
  "$n_core extracto(s) de clientes con el plazo de 24 h VENCIDO (el primero venció $desde_core). Si el Motor no tiene casos pendientes, el problema está entre el backend y el Motor: logs de BankStatementReviewWorker." \
  "Ningún extracto de cliente tiene el plazo de 24 h vencido."
