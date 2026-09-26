---
name: server-hardening
description: Gate de endurecimiento del VPS que corre Coolify — SSH solo con clave y sin root por contraseña, firewall con únicamente 22/80/443 y panel cerrado, parches automáticos, protección anti fuerza bruta, panel por dominio con TLS y 2FA, backups de la instancia, monitoreo de disco y separación producción/staging. Usar al provisionar o auditar un server, después de un incidente, al abrir cualquier puerto, y antes de alojar datos de salud.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Hardening del servidor

Un server con Coolify expone: el panel (que puede desplegar código arbitrario), el proxy, SSH y
Docker. Si el server aloja datos clínicos, esto es un control de `data-privacy-sensitive`, no un
extra. Complementa a `security-guardrails` (aplicación) y `coolify-operations` (plataforma).
Comandos orientativos para Debian/Ubuntu; adaptá a tu distribución y registrala en el
CLAUDE.md del proyecto de infraestructura.

## 1. Acceso SSH

- Solo autenticación por clave: `PasswordAuthentication no`, `PubkeyAuthentication yes`,
  `PermitRootLogin no` (o `prohibit-password` si Coolify administra el server como root por
  clave — Coolify usa SSH para operar servers; conservá su clave en `/data/coolify/ssh/keys/`).
- Claves personales, una por persona, con passphrase; revocación al salir alguien = quitar la
  clave, no cambiar una contraseña compartida.
- Puerto 22 (o el que definas) limitado por firewall a IPs conocidas cuando sea viable; si no,
  fail2ban o equivalente sobre `sshd`.
- Nada de `sudo` sin contraseña para usuarios humanos; registro de sesiones con `journalctl`.

## 2. Firewall

Puertos que Coolify necesita en el server donde corre (doc oficial): `22` SSH, `80` HTTP y
emisión de certificados, `443` HTTPS, y `8000`/`6001`/`6002` **solo** para acceder al panel por
IP directa. Una vez que el panel funciona por dominio a través del proxy, **cerrá 8000, 6001 y
6002**: dashboard, realtime y terminal pasan por 80/443.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

Advertencia: Docker manipula iptables y puede publicar puertos **saltándose ufw**. Por eso:
sin **Ports Mappings** al host en Coolify, bases sin `public_port`, y verificá desde afuera con
`nmap -Pn <ip>` o `nc -zv <ip> 5432` que nada más responde.
Alternativa para el panel: bindear la UI a `127.0.0.1:8000` en el override de compose y
acceder solo por dominio/proxy — asegurate de tener otra vía antes, o te bloqueás.

## 3. Panel de Coolify

- Dominio propio con `https://` y certificado automático; sin acceso por IP.
- **2FA obligatorio** para Owners y Admins; existe procedimiento oficial de reset de 2FA si
  alguien pierde el dispositivo (no lo improvises).
- Registro: contraseñas largas, sin usuarios compartidos, Members con permisos mínimos
  (`coolify-operations` §7). Desactivá el registro público de usuarios en la instancia.
- API habilitada solo si se usa; allowlist de IPs para la API cuando el CI tiene IP fija.
- Tokens de API con permiso mínimo, rotación y revocación documentadas.

## 4. Sistema operativo

- Actualizaciones de seguridad automáticas (`unattended-upgrades` o equivalente); reinicios
  programados en ventana. Coolify notifica **Server Patching** cuando hay parches pendientes.
- Hora sincronizada (NTP): certificados, logs y tokens dependen de ella.
- Solo los servicios necesarios escuchando: `ss -tulpn` debe mostrar sshd, docker-proxy del
  proxy de Coolify (80/443) y nada más hacia `0.0.0.0`.
- Docker actualizado; socket de Docker sin exponer por TCP; usuarios en el grupo `docker`
  equivalen a root — mínimos.
- Swap configurado y límites de memoria por contenedor para que un proceso no tumbe el host.

## 5. Datos y backups de la instancia

- `APP_KEY` de `/data/coolify/source/.env` guardado fuera del server (cifra los secretos).
- Backup de la base de Coolify y de `/data/coolify/ssh/keys/` fuera del server, probado
  (`coolify-databases-backups` §7).
- Volúmenes de bases con backup programado a S3 externo.
- Disco: alerta **Server Disk Usage** y limpieza automática de Docker; un disco lleno tumba
  deploys y puede corromper bases.

## 6. Separación de entornos

- Producción y staging en **servers distintos** cuando alojás datos clínicos; como mínimo,
  environments distintos, credenciales distintas y ninguna red compartida.
- Previews de PR nunca en el server de producción.
- Build server separado si los builds compiten con el tráfico.

## 7. Monitoreo y respuesta

- Notificaciones de Coolify: server unreachable, disco, Traefik desactualizado, backup fallido,
  deploy fallido, contenedor detenido.
- Logs del host centralizados o al menos con retención; acceso SSH y `sudo` auditables.
- Ante sospecha de compromiso: aislar (firewall), rotar `APP_KEY`-dependientes, tokens y
  credenciales de bases, restaurar desde backup limpio, y post-mortem
  (`incident-response-postmortem`). No "limpiar y seguir".

## Evidencia / Definition of Done

Para declarar el server endurecido, pegá literal:
1. `sshd -T | grep -E 'passwordauthentication|permitrootlogin|pubkeyauthentication'`.
2. `ufw status verbose` (o equivalente) mostrando solo 22/80/443.
3. Escaneo externo (`nmap -Pn <ip>` desde otra máquina) sin puertos extra.
4. `ss -tulpn` del host sin servicios inesperados en `0.0.0.0`.
5. Confirmación de 2FA activo en cada Owner/Admin y de registro público desactivado.
6. Fecha del último backup de instancia y dónde está el `APP_KEY`.
7. Estado de actualizaciones automáticas (`systemctl status unattended-upgrades` o equivalente).

Un escaneo externo con 5432 o 8000 abiertos es FAIL aunque "nadie conozca la IP".

## Checklist

- [ ] SSH solo por clave; root sin contraseña; una clave por persona.
- [ ] Firewall deny-by-default con 22/80/443; 8000/6001/6002 cerrados tras usar dominio.
- [ ] Sin Ports Mappings ni bases públicas; verificado desde afuera.
- [ ] Panel por dominio con TLS, 2FA, sin registro público, tokens mínimos.
- [ ] Parches automáticos, NTP, Docker actualizado, socket no expuesto.
- [ ] `APP_KEY`, claves SSH y base de Coolify respaldados fuera del server.
- [ ] Producción separada de staging y de previews.
- [ ] Alertas activas y plan de respuesta conocido por el equipo.
