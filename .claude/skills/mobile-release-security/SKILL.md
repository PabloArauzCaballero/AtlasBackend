---
name: mobile-release-security
description: Gate de seguridad y publicación de la app móvil — almacenamiento seguro de tokens (sobre Keychain/Keystore), certificate pinning, ofuscación del binario, permisos mínimos, firmado y publicación en las tiendas, versionado y prohibición de datos sensibles en logs/analytics/crash reports. Usar al configurar el almacenamiento de credenciales, antes de un release a las tiendas, al agregar un permiso o un SDK de terceros, y al revisar qué datos salen del dispositivo. Complementa a `authn-identity` y `data-privacy-sensitive`.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Release y seguridad móvil — Flutter

El dispositivo es un entorno hostil: puede estar rooteado, el binario se puede inspeccionar y el
tráfico interceptar. Protegé credenciales, binario y datos, y no dejes salir datos sensibles por telemetría.

## 1. Almacenamiento seguro de tokens

- Tokens de sesión/refresh en almacenamiento seguro del sistema: `flutter_secure_storage`, que usa
  **Keychain** en iOS y **Keystore / EncryptedSharedPreferences** en Android (verificá las opciones
  `IOSOptions`/`AndroidOptions` en pub.dev para tu versión).
- **Nunca** tokens ni datos sensibles en `shared_preferences`, en archivos en claro, ni logueados.
- Refresh token rotado; borrá todo lo sensible del dispositivo al cerrar sesión. Coordiná con
  `authn-identity` (ciclo de vida y rotación de tokens).

## 2. Certificate pinning

- Pineá el certificado/clave pública del backend para cortar intercepción (MITM), con la librería
  HTTP que use el proyecto (p. ej. pinning en `dio` o `SecurityContext`; verificá el mecanismo).
- Planificá la **rotación**: pinear la clave pública y tener un pin de respaldo evita dejar la app
  inutilizable cuando el certificado cambia. Documentá el procedimiento de rotación.

## 3. Ofuscación y binario

- Compilá release con ofuscación: `flutter build <apk|appbundle|ipa> --obfuscate --split-debug-info=<dir>`
  y **guardá** el `split-debug-info` para poder simbolizar crashes.
- No embebas secretos en el binario: una API key en el código Dart es extraíble. Lo que deba ser
  secreto vive en el backend; el cliente usa tokens de usuario.
- Considerá detección de root/jailbreak solo como señal, no como única defensa.

## 4. Permisos mínimos

- Pedí solo los permisos que el flujo usa, y en el momento en que se usan (no todos al arrancar).
- Revisá `AndroidManifest.xml` e `Info.plist`: quitá permisos heredados de plugins que no usás.
  Cada permiso extra es superficie y motivo de rechazo en revisión de la tienda.

## 5. Firmado y publicación

- Firmado release con keystore/certificado propios, **fuera del repositorio** (secretos en el CI o
  en el gestor de secretos; ver `environment-secrets-config`). Nunca subas el keystore al repo.
- `versionName`/`versionCode` (Android) y `CFBundleShortVersionString`/build (iOS) coordinados con
  el versionado del producto (ver `github-releases-versioning`).
- Canales de prueba antes de producción (internal/TestFlight). Cumplí las declaraciones de
  privacidad/datos de cada tienda con la verdad de lo que la app recolecta.

## 6. Telemetría sin datos sensibles

- Crash reporting y analytics: **jamás** datos sensibles, tokens ni identificadores clínicos en eventos,
  breadcrumbs o mensajes de error. Filtrá/allow-list los campos que se envían.
- Logs de release al mínimo; nada de volcar respuestas de la API con datos de pacientes.
  Ver `data-privacy-sensitive` y `backend-observability` (mismo criterio de no-PII en logs).

## Evidencia / DoD
Antes de declarar un release listo, pegá/mostrá:
- Grep del repo sin secretos/keystore versionados; confirmación de que los tokens van a secure storage.
- Comando de build release con `--obfuscate --split-debug-info` y el artefacto generado.
- Lista de permisos efectivos del manifest/plist justificada uno por uno.
- Verificación de que analytics/crash no incluyen datos sensibles (muestra de un evento).

## Checklist
- [ ] Tokens en secure storage (Keychain/Keystore); nada sensible en `shared_preferences` ni logs.
- [ ] Certificate pinning activo con plan de rotación documentado.
- [ ] Build release ofuscado con `split-debug-info` guardado; sin secretos en el binario.
- [ ] Permisos mínimos, pedidos en contexto; manifest/plist revisados.
- [ ] Keystore/certificados fuera del repo; versión coordinada con el release del producto.
- [ ] Analytics y crash reporting sin datos sensibles ni tokens; declaraciones de la tienda veraces.
