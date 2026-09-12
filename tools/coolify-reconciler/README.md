# Reconciliador de `dev` → VPS

Mantiene las seis aplicaciones de Atlas en el VPS a la altura de la punta de `dev`.

## Por qué existe, si ya hay autodespliegue

Hay **dos caminos, y hacen falta los dos**:

| | camino rápido | red de debajo (esto) |
|---|---|---|
| qué es | `.github/workflows/deploy-dev.yml` en cada repo | `reconcile-dev.sh` + temporizador de systemd |
| cuándo actúa | en el `push` | cada 15 min |
| latencia | minutos | hasta 15 min |
| qué NO cubre | que el build falle, que el runner muera, que Coolify se autoactualice y mate la cola | nada: sólo compara estado real contra GitHub |

El workflow ya espera al estado terminal del despliegue y falla si no es `finished` (corregido el
2026-09-05). Eso hace que **te enteres** de un fallo, pero no que se arregle: el commit se queda
sin desplegar y el VPS sirviendo la versión vieja hasta que alguien lo mira. Esto lo cierra.

Es reconciliación **por atracción**: no le importa por qué se quedó atrás, sólo que lo está.

## Qué hace exactamente

Para cada una de las seis aplicaciones:

1. Lee la punta de `dev` en GitHub con `git ls-remote`. Los repos son públicos: **sin token**.
2. Pregunta a la base de Coolify cuál fue el último despliegue `finished` y su commit.
3. Si coinciden, no hace nada.
4. Si hay un despliegue `queued` o `in_progress`, lo respeta y no encola otro.
5. Si difieren, le pide a Coolify que encole uno.

**No construye nada.** El trabajo pesado lo sigue haciendo Coolify, de uno en uno.

## Los tres cinturones

Son la diferencia con el `tools/autodeploy/` viejo, que se desactivó el 2026-09-03 tras dejar
67 GB de caché y carga sostenida de 12:

- **Tope de reintentos** (`MAX_INTENTOS=2`). Un commit que no compila se reencolaría cada cuarto de
  hora para siempre. Al tercer intento el script lo declara `ATASCO`, deja de tocarlo y pone la
  unidad en rojo para que se vea en `systemctl status`.
- **Lista blanca de seis UUID.** La máquina hospeda además `alovida`, `mantra` y
  `economic-observatory`. Lo que no está en la lista no se mira.
- **`Nice=10` + `IOSchedulingClass=idle` + `flock`.** Nunca compite con un build por la CPU, y una
  pasada lenta no se solapa con la siguiente.

## Instalación

    sudo install -m 0755 reconcile-dev.sh /usr/local/bin/atlas-reconcile-dev.sh
    sudo install -m 0644 systemd/atlas-reconcile.service /etc/systemd/system/
    sudo install -m 0644 systemd/atlas-reconcile.timer   /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now atlas-reconcile.timer

## Operación

    systemctl list-timers atlas-reconcile.timer     # cuándo dispara la próxima
    systemctl status atlas-reconcile.service        # rojo = hay un ATASCO o un ERROR
    journalctl -u atlas-reconcile.service -n 50     # qué vio en las últimas pasadas
    sudo systemctl start atlas-reconcile.service    # forzar una pasada ahora

Una pasada normal se lee así:

    OK     atlas-erp-backend: al dia en 810857bf85
    VUELO  atlas-backend: ccfff58aa8 -> 6c0549ddbf, ya hay despliegue en curso
    DESFASE atlas-admin-portal: 01903c63bc -> e58be3b65f, encolando (intento 1)
    resumen: 4 al dia, 1 en vuelo, 1 encolados, 0 atascados, 0 errores

### Si sale `ATASCO`

El commit falló dos veces. **No lo reencoles a mano sin mirar antes el log del build en Coolify**:
si falla dos veces seguidas suele ser el código o una variable, no un tropiezo. Cuando esté
arreglado, el commit siguiente a `dev` reinicia la cuenta por sí solo.

## Para pararlo

    sudo systemctl disable --now atlas-reconcile.timer

Parar el temporizador **no** rompe el despliegue: el camino rápido de GitHub Actions sigue igual.
