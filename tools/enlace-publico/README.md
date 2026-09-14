# El enlace público de Atlas

Cómo se publica Atlas hacia internet desde el H310 (un equipo de casa, sin puertos entrantes: se
comprobó que 80 y 443 de `189.28.77.171` no aceptan conexiones, así que un túnel es obligatorio).

## Hoy: Tailscale Funnel, sobre un hostname COMPARTIDO

    https://pablo-h310.taila8f993.ts.net

| ruta / puerto | quién responde |
|---|---|
| `/` · `:8443` | AloVida |
| `:10000` | economic-observatory |
| `/api/v1` · `/legal` · `/atlas-evidence` | **Atlas** (Traefik en `127.0.0.1:80`) |

Se eligió Funnel porque vive dentro de `tailscaled`, que es un servicio del sistema: **vuelve solo
tras un reinicio**. Lo anterior eran cinco `devtunnel host` arrancados a mano que murieron en el
reinicio del 2026-09-13 y que ya no se pueden rearrancar sin un login interactivo de GitHub.

Dos cosas que no son obvias y que costaron horas:

- **`--set-path` RECORTA el prefijo.** `--set-path /api/v1 http://127.0.0.1:80` hace que al destino le
  llegue `/health`, y Next responde su página 404 **con código 200**. Hay que repetir la ruta en el
  destino: `--set-path /api/v1 http://127.0.0.1:80/api/v1`.
- **El hostname es compartido y alguien puede pisarlo.** Pasó: tras un reinicio la raíz quedó
  apuntando a AloVida y la app móvil estuvo horas recibiendo HTML de otro producto, devolviendo 200.
  Por eso `atlas-enlace-guardian` (systemd timer, cada 5 min) comprueba el **cuerpo** de
  `/api/v1/health` y reaplica sólo las rutas de Atlas.

## Mañana: dominio propio (lo que resuelve el problema de raíz)

Mientras el hostname sea compartido, esto es mitigación, no aislamiento. Y hay un coste recurrente:
**la URL va horneada dentro del APK**, así que cada cambio de túnel obliga a recompilar y a repartir
la app otra vez. Con dominio propio deja de pasar: cambian el túnel, el servidor o la casa, y la app
ni se entera.

Cuando haya dominio, `migrar-a-dominio.sh` hace el cambio. Lee su cabecera antes de ejecutarlo.
