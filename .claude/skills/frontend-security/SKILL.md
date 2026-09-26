---
name: frontend-security
description: Gate de seguridad del cliente web — XSS y el sanitizador de Angular (`DomSanitizer`, riesgos de `bypassSecurityTrust*`), Content-Security-Policy y Trusted Types, no guardar tokens en `localStorage`, CSRF según el modelo de auth, datos sensibles fuera del HTML de SSR y del transfer state, y control de dependencias del front. Usar al renderizar HTML dinámico, al integrar contenido de terceros, al decidir dónde vive el token de sesión, o al revisar cualquier vista que muestre datos de pacientes.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Seguridad del cliente — gate

El navegador es territorio hostil: el usuario puede leer todo lo que llega al cliente y un
atacante puede inyectar script. El front no reemplaza los controles del backend
(`security-guardrails`, `authz-access-control`) — los complementa evitando XSS, fuga de datos
y robo de sesión.

## 1. XSS y el sanitizador de Angular

- La interpolación `{{ }}` y los property bindings **escapan** por defecto: son seguros.
- El riesgo aparece con `[innerHTML]`, `bypassSecurityTrust*` y APIs de DOM crudas.
- Angular sanea el HTML que entra por `[innerHTML]`. **No** desactives eso. Si de verdad
  necesitás confiar en un fragmento, `bypassSecurityTrustHtml` es la puerta trasera — cada
  uso es una vulnerabilidad potencial y necesita justificación y una fuente confiable.

```typescript
// ❌ confiar en HTML de origen no controlado = XSS
el.innerHTML = respuestaDelUsuario;
this.sanitizer.bypassSecurityTrustHtml(contenidoDeTercero);

// ✅ dejar que Angular sanee, o no meter HTML crudo
// <div [innerHTML]="contenido"></div>  → Angular remueve <script>, on*, etc.
```

Nunca construyas HTML/URL concatenando entrada del usuario para pasarla a un bypass.

## 2. CSP y Trusted Types

- Serví una **Content-Security-Policy** que restrinja `script-src` (sin `unsafe-inline`) para
  que un XSS inyectado no ejecute.
- Angular soporta **Trusted Types**: activá `require-trusted-types-for 'script'`. Si usás
  algún `bypassSecurityTrust*`, la política necesita permitir el bypass de Angular
  explícitamente (`trusted-types angular angular#unsafe-bypass`), lo que además vuelve
  auditable cada bypass.
- Definí la CSP y los security headers del lado del servidor/proxy (ver `server-hardening`).

## 3. Dónde vive el token de sesión

- **No** guardes tokens de sesión en `localStorage`/`sessionStorage`: cualquier XSS los lee.
- Preferí cookie `HttpOnly` + `Secure` + `SameSite` para la sesión; el JS no la ve. El modelo
  de auth completo está en `authn-identity`.
- Si el diseño exige un token accesible por JS, mantenelo solo en memoria (un signal/servicio),
  nunca persistido, y asumí que un XSS lo compromete.

## 4. CSRF

- Con auth por cookie, protegé contra CSRF: token anti-CSRF o `SameSite=Strict/Lax` según el
  flujo. Angular envía automáticamente el header `X-XSRF-TOKEN` si existe la cookie `XSRF-TOKEN`.
- Con auth por header `Authorization: Bearer` (no cookie), el CSRF clásico no aplica, pero
  vuelve el problema de dónde guardar el token (punto 3).

## 5. Datos sensibles en el cliente y en SSR

- No incrustes en el HTML servido, ni en el transfer state de SSR, datos que el usuario no
  debería ver o que son datos sensibles innecesaria. El transfer cache de HTTP debe excluir respuestas con
  headers de auth y datos sensibles (ver `data-privacy-sensitive`).
- La UI **no** es barrera de autorización: ocultar un botón no protege el endpoint. Todo se
  valida en el backend (`authz-access-control`).
- No pongas secretos (API keys de servicios de pago, etc.) en el bundle del cliente: es público.

## 6. Dependencias del front

- El código de terceros corre con los permisos de tu página. Fijá versiones (lockfile),
  revisá lo que agregás, y corré auditoría de dependencias en CI (ver `github-security-features`,
  `dependency-management`).
- Cuidado con scripts de terceros embebidos (analytics, widgets): pueden leer el DOM y la
  entrada del usuario. Restringilos por CSP y evaluá su necesidad en páginas con datos sensibles.

## Evidencia / DoD

Para declarar segura la superficie del cliente que tocaste, pegá:
- `grep` de `bypassSecurityTrust`/`innerHTML`/`localStorage` en el diff, con justificación de cada aparición.
- La CSP efectiva servida (header real, no la intención).
- Confirmación de dónde vive el token (cookie HttpOnly o memoria) y de que no se persiste en storage.
- Para vistas SSR con datos: qué se incluye en el transfer state y por qué no hay datos sensibles de más.

## Checklist

- [ ] Sin `bypassSecurityTrust*` no justificado; `[innerHTML]` solo con contenido saneado o confiable.
- [ ] CSP con `script-src` sin `unsafe-inline`; Trusted Types activo si aplica.
- [ ] Token de sesión en cookie `HttpOnly`/`Secure`/`SameSite`, no en `localStorage`.
- [ ] CSRF cubierto según el modelo de auth.
- [ ] Sin datos sensibles ni secretos innecesarios en HTML SSR, transfer state o bundle.
- [ ] Dependencias del front fijadas y auditadas; scripts de terceros restringidos.
