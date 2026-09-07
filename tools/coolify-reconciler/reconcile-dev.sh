#!/usr/bin/env bash
#
# Reconciliador: deja el VPS en la punta de `dev`, pase lo que pase con el camino de subida.
#
# NO sustituye a `.github/workflows/deploy-dev.yml`, lo COMPLEMENTA. El workflow es el camino
# rapido: empujas y a los pocos minutos esta arriba. Este script es la red debajo: cada cuarto de
# hora compara lo desplegado con lo que hay en GitHub y, si algo se quedo atras, lo vuelve a
# encolar. Cubre los casos en que el camino rapido no llega:
#
#   - el build fallo y nadie lo reintento;
#   - Coolify se autoactualizo y mato la cola (los encolados pasan a `failed` sin haber corrido);
#   - el runner murio antes de llamar (tailscale, cuota, GitHub caido);
#   - alguien empujo con el workflow desactivado.
#
# NO ES el viejo `tools/autodeploy/` —desactivado el 2026-09-03 porque construia las imagenes el
# mismo, cada minuto, y dejo 67 GB de cache y carga sostenida de 12—. Este script **no construye
# nada**: solo pregunta y, como mucho, le pide a Coolify que encole. El trabajo pesado lo sigue
# haciendo Coolify, de uno en uno (`concurrent_builds: 1`).
#
# Se instala como unidad de systemd DEL SISTEMA (necesita docker), no de usuario:
#   tools/coolify-reconciler/systemd/atlas-reconcile.{service,timer}
#
set -uo pipefail

# Solo estas seis. La maquina hospeda ademas alovida, mantra y economic-observatory, y este script
# no debe tocarlas jamas: lo que aqui no este listado no se mira.
APPS=(
  "atlas-backend|jx5gcladzyxaxapqcnlksfcd|AtlasBackend"
  "atlas-admin-portal|cqnfvhqznphueesptlypiuxo|AtlasAdminPortal"
  "atlas-erp-backend|itukcyrhhhxw5k34a3ryn9i3|AtlasERPBackend"
  "atlas-erp-frontend|qydcd9f0ye4ixg8wk6oqpt9n|AtlasERPFrontend"
  "atlas-decision-engine-backend|o4hnckqkvg8kutc71f8dwnhg|AtlasDecisionEngineBackend"
  "atlas-decision-engine-frontend|taiulz47mikqbszggwfshtxe|AtlasDecisionEngineFrontend"
)
DUENO=PabloArauzCaballero
RAMA=dev

# Cuantas veces se reintenta un MISMO commit antes de rendirse. Sin este tope, un commit que no
# compila se reencola cada cuarto de hora para siempre: la maquina se pasa el dia construyendo algo
# que no puede salir bien, y el build legitimo del vecino no coge turno nunca.
MAX_INTENTOS=2

sql() { docker exec -i coolify-db psql -U coolify -d coolify -At -F'|' -c "$1" 2>/dev/null; }

encolar() {
  docker exec coolify php /var/www/html/artisan tinker --execute="
    \$a = App\\Models\\Application::where('uuid','$1')->first();
    if (\$a) { queue_application_deployment(application: \$a, deployment_uuid: (string) new \\Visus\\Cuid2\\Cuid2(), is_api: true); echo 'encolado'; }
    else { echo 'sin-aplicacion'; }
  " 2>/dev/null | tr -d '\r\n'
}

al_dia=0; en_vuelo=0; encolados=0; atascados=0; errores=0

for fila in "${APPS[@]}"; do
  IFS='|' read -r nombre uuid repo <<<"$fila"

  # La punta de `dev` en GitHub. Los repos son publicos: sin token, sin secretos que rotar.
  tip=$(timeout 30 git ls-remote "https://github.com/$DUENO/$repo" "refs/heads/$RAMA" 2>/dev/null | cut -f1)
  if [ -z "$tip" ]; then
    echo "ERROR  $nombre: no se pudo leer $RAMA de GitHub"; errores=$((errores + 1)); continue
  fi

  # `commit` vale 'HEAD' mientras el despliegue esta en cola y solo se resuelve al arrancar el
  # build: por eso se excluye, comparar contra 'HEAD' daria siempre distinto.
  lectura=$(sql "
    select
      (select count(*) from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status in ('queued','in_progress')),
      coalesce((select d.commit from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status = 'finished'
           and d.commit is not null and d.commit <> 'HEAD'
         order by d.id desc limit 1), ''),
      -- Los fallos con commit = 'HEAD' NO cuentan, y es deliberado: son despliegues que murieron
      -- ANTES de arrancar el build (la autoactualizacion de Coolify pasa a `failed` lo que tenia
      -- encolado sin correr), asi que no gastan intento — no hay nada que indique que el commit
      -- este roto. Medido el 2026-09-06: 42 de los 44 `failed` si traen el commit resuelto, que
      -- son los fallos de build de verdad y los unicos que deben acercar el ATASCO.
      (select count(*) from application_deployment_queues d
         where d.application_id = a.id::varchar and d.status = 'failed' and d.commit = '$tip')
    from applications a where a.uuid = '$uuid';")

  if [ -z "$lectura" ]; then
    echo "ERROR  $nombre: no esta en Coolify"; errores=$((errores + 1)); continue
  fi
  IFS='|' read -r vuelo desplegado fallos <<<"$lectura"

  if [ "$desplegado" = "$tip" ]; then
    echo "OK     $nombre: al dia en ${tip:0:10}"; al_dia=$((al_dia + 1)); continue
  fi
  # Un despliegue ya en marcha se respeta: encolar otro solo alarga la cola.
  if [ "${vuelo:-0}" -gt 0 ]; then
    echo "VUELO  $nombre: ${desplegado:0:10} -> ${tip:0:10}, ya hay despliegue en curso"
    en_vuelo=$((en_vuelo + 1)); continue
  fi
  if [ "${fallos:-0}" -ge "$MAX_INTENTOS" ]; then
    echo "ATASCO $nombre: ${tip:0:10} fallo $fallos veces, NO se reintenta (mira el log del build)"
    atascados=$((atascados + 1)); continue
  fi

  echo "DESFASE $nombre: ${desplegado:0:10} -> ${tip:0:10}, encolando (intento $((fallos + 1)))"
  echo "        respuesta de coolify: $(encolar "$uuid")"
  encolados=$((encolados + 1))
done

echo "resumen: $al_dia al dia, $en_vuelo en vuelo, $encolados encolados, $atascados atascados, $errores errores"
# Solo un ATASCO o un ERROR ponen la unidad en rojo. Un desfase recien encolado es el
# funcionamiento normal, no una averia.
[ $((atascados + errores)) -eq 0 ]
