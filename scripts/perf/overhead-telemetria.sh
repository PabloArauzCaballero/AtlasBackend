#!/bin/zsh
# Coste de la instrumentación de OpenTelemetry: la MISMA carga en cuatro configuraciones.
#
#   RAIZ=/ruta/al/worktree PUERTO=53105 zsh scripts/perf/overhead-telemetria.sh
#
# Exige un backend YA COMPILADO en `$RAIZ/dist` y un Jaeger escuchando en 127.0.0.1:4318
# (`yarn jaeger:up`). No arranca nada del árbol compartido: se ejecuta en un worktree aparte,
# porque `tsc` reemplaza `dist/` y tumbaría un backend que otra sesión tuviera levantado.
#
# Resultados en `$SALIDA/resultados.tsv` (por omisión `$RAIZ/medicion-overhead`). Sólo cuentan
# las filas con `valida=si`; las demás se conservan a propósito, porque saber QUÉ se descartó y
# por qué es parte del resultado.
#
# Las rondas van INTERCALADAS y no agrupadas: agrupar las corridas de una configuración le carga
# entera cualquier deriva de la máquina, y eso se lee después como el efecto de la telemetría.
#
# ── POR QUÉ HAY GUARDAS, Y POR QUÉ SON TRES ────────────────────────────────────────────────────
# Esta medición se tiró entera tres veces el 2026-09-19 antes de servir, y los tres modos de
# fallo producían números plausibles:
#
#   1. Otra sesión compilando al 271 % de un núcleo -> el p95 pasó de 21 ms a 7.696 ms.
#   2. El equipo SE DURMIÓ a mitad -> `Ventana medida: 0,07 s`, UNA petición completada, y un
#      p50 = p95 = p99 = 71,42 ms, o sea un único dato presentado como tres percentiles.
#   3. Contención sin suspensión -> retraso del generador de 48 a 763 ms.
#
# Ninguna señal sola los cubre, y está comprobado contra las corridas corrompidas: el retraso
# del generador delata TRES de las cuatro y no la cuarta (retraso 0 ms y p95 de 86 ms); el
# throughput no delata NINGUNA (10,01 req/s en la peor). De ahí las tres condiciones de validez
# y el `caffeinate` que se sostiene mientras dura la medición.
#
# El tope de CPU ajena está donde lo pone el dato: por encima de 120 % están las corridas que se
# corrompieron (152-271 %) y por debajo una idéntica a la línea base con un vecino al 89 %.
# Aflojarlo después de ver los números que descarta sería ajustar el filtro al desenlace.
set -u
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
cd "${RAIZ:?Define RAIZ: el worktree con el backend ya compilado}"
OUT="${SALIDA:-$RAIZ/medicion-overhead}"
LOG=$OUT/bitacora.txt
RES=$OUT/resultados.tsv
# 120 % de un núcleo: por encima de eso están las corridas que se corrompieron (152–271 %) y por
# debajo la que salió idéntica a la línea base con un vecino puntual al 89 %.
TOPE_CPU_AJENA=${TOPE_CPU_AJENA:-120}
# Umbral para EMPEZAR: más exigente que el de validez, para no arrancar cuesta arriba.
TOPE_PARA_EMPEZAR=${TOPE_PARA_EMPEZAR:-60}
TOPE_RETRASO_MS=${TOPE_RETRASO_MS:-5}
# Una corrida SUSPENDIDA es el tercer modo de fallo y el más engañoso: el equipo se durmió a
# mitad y el arnés publicó `Ventana medida: 0,07 s`, `1 petición completada` y un p50 = p95 = p99
# de 71,42 ms, con retraso del generador 0 ms y CPU ajena baja. Las dos guardas anteriores lo
# daban por bueno. Se comprueba por tanto la FORMA de la corrida: la ventana tiene que durar lo
# que dice el escenario y tienen que haberse completado las peticiones esperadas.
MIN_VENTANA_S=${MIN_VENTANA_S:-115}
MIN_COMPLETADAS=${MIN_COMPLETADAS:-1100}
[ -f $RES ] || echo "ronda\tconfig\tarranque_ms\tp50\tp95\tp99\tthroughput\terrores_pct\tretraso_p95\tventana_s\tcompletadas\tcpu_proc_s\tcpu_ajena_max\trss_fin_mb\tcierre_ms\tvalida\tevidencia" > $RES

# El equipo se duerme entre las ventanas de `caffeinate` de otras sesiones (5 min cada una), y
# un proceso suspendido a mitad de corrida produce datos sin sentido. Esta aserción dura lo que
# dure la medición y se retira sola al terminar.
caffeinate -dimsu -w $$ &
CAFEINA=$!
echo "$(date +%H:%M:%S) sueño del sistema inhibido mientras dure la medición (caffeinate pid=$CAFEINA)" >> $LOG

# Tiempo de CPU acumulado del proceso, en segundos. `ps -o time=` lo da como [DD-]HH:MM:SS.ss.
#
# POR QUÉ SE MIDE ESTO Y NO SÓLO LA LATENCIA. La latencia de pared es lo que ve el usuario, pero
# en una máquina compartida la roba cualquier vecino: el 2026-09-19 el p95 de la MISMA
# configuración osciló entre 21 y 228 ms según quién más estuviera compilando. El tiempo de CPU
# del proceso, en cambio, es suyo: un vecino le quita turnos de reloj, no ciclos consumidos. La
# pregunta «cuánto cuesta la instrumentación» se responde mejor con los ciclos que gasta el
# backend por petición que con un percentil que depende de la vecindad.
cpu_proceso_s() {
  local pid=$1
  ps -o time= -p $pid 2>/dev/null | python3 -c "
import sys
t = sys.stdin.read().strip()
if not t:
    print(0); raise SystemExit
dias = 0
if '-' in t:
    dias, t = t.split('-', 1)
    dias = int(dias)
partes = [float(x) for x in t.split(':')]
seg = 0.0
for x in partes:
    seg = seg * 60 + x
print(f'{seg + dias * 86400:.2f}')
"
}

carga1() { uptime | sed -n 's/.*load averages*: *\([0-9.]*\).*/\1/p'; }

# CPU del MAYOR proceso ajeno, en porcentaje de un núcleo. Se mira el mayor y no la suma porque
# el suelo de la suma es alto e irrelevante (WindowServer, navegador, contenedores en reposo) y
# el ruido que importa tiene forma de UN proceso: una compilación o una suite ajena.
cpu_ajena() {
  ps -Ao pcpu,args -r \
    | awk 'NR>1 {print}' \
    | grep -v "$RAIZ/dist/src/main.js" \
    | grep -v "$OUT" \
    | grep -v 'scripts/perf/load.ts' \
    | awk 'NR==1 {printf "%.0f", $1+0}'
}

esperar_maquina_quieta() {
  local intentos=0
  while true; do
    local c=$(cpu_ajena)
    if [ "$c" -lt "$TOPE_PARA_EMPEZAR" ]; then
      echo "$(date +%H:%M:%S) máquina quieta (cpu ajena=${c} %, carga=$(carga1))" >> $LOG
      return 0
    fi
    intentos=$(( intentos + 1 ))
    [ $(( intentos % 10 )) = 1 ] && echo "$(date +%H:%M:%S) esperando: cpu ajena=${c} % (tope ${TOPE_PARA_EMPEZAR} %)" >> $LOG
    sleep 30
  done
}

arrancar() {
  local t0=$(python3 -c 'import time;print(int(time.time()*1000))')
  node dist/src/main.js > $OUT/api-$1.log 2>&1 &
  APIPID=$!
  local ok=0
  for i in $(seq 1 90); do
    sleep 1
    curl -s -m 3 http://localhost:${PUERTO:-53105}/api/v1/health >/dev/null 2>&1 && { ok=1; break; }
  done
  local t1=$(python3 -c 'import time;print(int(time.time()*1000))')
  ARRANQUE_MS=$(( t1 - t0 ))
  [ $ok = 1 ] || { echo "$(date +%H:%M:%S) NO ARRANCÓ $1" >> $LOG; return 1; }
  return 0
}

parar() {
  local t0=$(python3 -c 'import time;print(int(time.time()*1000))')
  kill -TERM $APIPID 2>/dev/null
  for i in $(seq 1 40); do sleep 0.5; kill -0 $APIPID 2>/dev/null || break; done
  kill -0 $APIPID 2>/dev/null && kill -9 $APIPID 2>/dev/null
  wait $APIPID 2>/dev/null
  local t1=$(python3 -c 'import time;print(int(time.time()*1000))')
  CIERRE_MS=$(( t1 - t0 ))
}

correr() {
  local ronda=$1 cfg=$2
  local muestras=$OUT/cpu-$cfg-$ronda.txt
  : > $muestras
  ( while true; do cpu_ajena >> $muestras; echo >> $muestras; sleep 5; done ) &
  local SAMPLER=$!

  local cpu0=$(cpu_proceso_s $APIPID)
  echo "$(date +%H:%M:%S) ronda=$ronda config=$cfg arranque=${ARRANQUE_MS}ms cpu0=${cpu0}s" >> $LOG
  yarn perf:load --scenario=baseline --base-url=http://localhost:${PUERTO:-53105} > $OUT/carga-$cfg-$ronda.txt 2>&1
  local cpu1=$(cpu_proceso_s $APIPID)
  kill $SAMPLER 2>/dev/null; wait $SAMPLER 2>/dev/null
  local cpu_gastada=$(python3 -c "print(f'{max(0.0, $cpu1 - $cpu0):.2f}')")

  local cpumax=$(sort -n $muestras | tail -1)
  [ -z "$cpumax" ] && cpumax=0
  local ev=$(grep -o "$RAIZ/artifacts/[^ ]*\.json" $OUT/carga-$cfg-$ronda.txt | tail -1)
  local rss=$(ps -o rss= -p $APIPID 2>/dev/null | tr -d ' ')
  [ -n "$rss" ] && rss=$(( rss / 1024 )) || rss=0
  local linea=$(grep "Latencia global" $OUT/carga-$cfg-$ronda.txt)
  local p50=$(echo $linea | sed -n 's/.*p50=\([0-9.]*\)ms.*/\1/p')
  local p95=$(echo $linea | sed -n 's/.*p95=\([0-9.]*\)ms.*/\1/p')
  local p99=$(echo $linea | sed -n 's/.*p99=\([0-9.]*\)ms.*/\1/p')
  local thr=$(grep "^Throughput" $OUT/carga-$cfg-$ronda.txt | sed -n 's/.*: \([0-9.]*\) req\/s.*/\1/p')
  local err=$(grep "^Tasa de error" $OUT/carga-$cfg-$ronda.txt | sed -n 's/.*: \([0-9.]*\)%.*/\1/p')
  local lag=$(grep "^Retraso generador" $OUT/carga-$cfg-$ronda.txt | sed -n 's/.*p95=\([0-9]*\)ms.*/\1/p')
  [ -z "$lag" ] && lag=9999
  local ventana=$(grep "^Ventana medida" $OUT/carga-$cfg-$ronda.txt | sed -n 's/.*: \([0-9.]*\)s.*/\1/p')
  [ -z "$ventana" ] && ventana=0
  local hechas=$(grep "^Peticiones" $OUT/carga-$cfg-$ronda.txt | sed -n 's/.*: \([0-9]*\) completadas.*/\1/p')
  [ -z "$hechas" ] && hechas=0
  parar

  local valida=si
  [ -z "$p95" ] && valida=NO
  [ "$cpumax" -ge "$TOPE_CPU_AJENA" ] && valida=NO
  [ "$lag" -gt "$TOPE_RETRASO_MS" ] && valida=NO
  [ "$(echo "$ventana < $MIN_VENTANA_S" | bc -l)" = "1" ] && valida=NO
  [ "$hechas" -lt "$MIN_COMPLETADAS" ] && valida=NO
  echo "$ronda\t$cfg\t$ARRANQUE_MS\t$p50\t$p95\t$p99\t$thr\t$err\t$lag\t$ventana\t$hechas\t$cpu_gastada\t$cpumax\t$rss\t$CIERRE_MS\t$valida\t$ev" >> $RES
  echo "$(date +%H:%M:%S)   -> p50=$p50 p95=$p95 p99=$p99 retraso=${lag}ms ventana=${ventana}s hechas=$hechas cpu_proc=${cpu_gastada}s cpu_ajena_max=${cpumax}% valida=$valida" >> $LOG
  [ "$valida" = "si" ]
}

corrida_valida() {
  local ronda=$1 cfg=$2
  for intento in 1 2 3 4 5 6; do
    esperar_maquina_quieta
    arrancar $cfg || { sleep 20; continue; }
    correr $ronda $cfg && return 0
    echo "$(date +%H:%M:%S) ronda=$ronda config=$cfg intento=$intento DESCARTADO" >> $LOG
    sleep 20
  done
  echo "$(date +%H:%M:%S) ronda=$ronda config=$cfg SIN CORRIDA VÁLIDA" >> $LOG
  return 1
}

for ronda in 1 2 3 4; do
  unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_TRACES_SAMPLER_ARG
  export OTEL_ENABLED=false
  corrida_valida $ronda apagada

  export OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_TRACES_SAMPLER_ARG=1.0
  corrida_valida $ronda jaeger-100

  export OTEL_TRACES_SAMPLER_ARG=0.10
  corrida_valida $ronda jaeger-10

  export OTEL_TRACES_SAMPLER_ARG=1.0 OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4999
  corrida_valida $ronda sin-destino
done
echo "MEDICION-TERMINADA" >> $LOG
