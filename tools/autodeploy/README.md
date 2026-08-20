# Auto-despliegue local

Lo que hace Render, en esta máquina: vigila `dev`, construye la imagen del commit nuevo, la comprueba
y la pone a servir — sin cambiar el enlace que ya tienen los testers.

    tools/autodeploy/autodeploy.sh estado        # qué hay desplegado y qué commit espera
    tools/autodeploy/autodeploy.sh una-vez       # una pasada
    tools/autodeploy/autodeploy.sh vigilar       # bucle en primer plano
    tools/autodeploy/autodeploy.sh canario erp   # construye y comprueba sin tocar el puerto bueno
    tools/autodeploy/autodeploy.sh desplegar erp # fuerza el despliegue
    tools/autodeploy/autodeploy.sh historial     # los despliegues, con su resultado
    tools/autodeploy/autodeploy.sh parar [slug]  # baja contenedores (no toca los túneles)

Como servicio del sistema:

    ln -sf "$PWD/systemd"/atlas-autodeploy.{service,timer} ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now atlas-autodeploy.timer

## Lo que hay que saber antes de tocarlo

- **El puerto es el contrato.** El túnel apunta a un puerto, no a un contenedor; por eso cada
  servicio vuelve siempre al suyo (3005 / 3020 / 3100) y por eso el script no toca ningún proceso
  `devtunnel`. Ver [`../devtunnels/`](../devtunnels/).
- **No toca tu copia de trabajo.** Construye desde un `git worktree` desprendido en `/tmp`. Lo que se
  despliega es lo que está en `dev`, no lo que tengas a medias.
- **Un fallo no tumba el servicio.** La imagen se comprueba en un puerto aparte antes del cambio, y
  si tras el cambio no responde, vuelve la imagen anterior.

Estado, log e historial en `estado/` (no versionado). El detalle completo, en el
[runbook](../../docs/runbooks/despliegue-produccion.md#6-ter-auto-despliegue-en-el-servidor-de-pruebas-toolsautodeploy).
