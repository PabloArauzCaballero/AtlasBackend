# Mobile Development Context — Atlas Consumer App

## 1. Stack obligatorio

- React Native.
- Expo.
- TypeScript strict.
- Expo Router o React Navigation, según repo existente.
- SecureStore para tokens y secretos locales.
- AsyncStorage solo para datos no sensibles.
- API client compartido o equivalente adaptado a mobile.
- Push notifications con Expo Notifications o proveedor aprobado.

## 2. Alcance mobile

La app móvil es para consumidores. Debe cubrir:

- Registro y login.
- KYC.
- Consentimientos.
- Evaluación de crédito.
- Línea disponible.
- Compras BNPL.
- Calendario de cuotas.
- Recordatorios.
- Notificaciones push.
- Historial de pagos/compras.
- Captura de señales permitidas de dispositivo/comportamiento.

## 3. Privacidad crítica

- No subir agenda de contactos al backend.
- Si se usa score de contactos, se calcula en dispositivo y solo se envía un indicador agregado permitido.
- Pedir consentimiento claro antes de usar permisos sensibles.
- No recolectar ubicación, contactos, cámara, biometría o archivos sin justificación de producto y permiso explícito.
- No guardar biometría cruda en app ni backend salvo especificación legal/técnica aprobada.

## 4. Estructura recomendada

```txt
apps/mobile/
├── app/
├── src/
│   ├── components/
│   ├── screens/
│   ├── services/
│   ├── hooks/
│   ├── stores/
│   ├── lib/
│   │   ├── apiClient.ts
│   │   ├── secureStorage.ts
│   │   ├── money.ts
│   │   └── dates.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── onboarding/
│   │   ├── kyc/
│   │   ├── credit-line/
│   │   ├── purchases/
│   │   ├── installments/
│   │   └── notifications/
│   ├── types/
│   └── i18n/
└── README.md
```

## 5. API client mobile

Debe manejar:

- Base URL por ambiente.
- Access token desde SecureStore.
- Refresh token si aplica.
- Request ID.
- Errores normalizados.
- Timeouts.
- Reintentos solo en operaciones idempotentes.
- Modo offline/degradado cuando sea necesario.

No llamar `fetch` directamente desde pantallas.

## 6. UX mínima obligatoria

Cada flujo sensible debe tener:

- Loading claro.
- Reintento controlado.
- Mensaje de error entendible.
- Explicación de permisos.
- Estado vacío.
- Protección ante doble tap / doble envío.
- Confirmación antes de acciones críticas.

## 7. KYC

- Cámara/documentos solo mediante flujo controlado.
- Si hay proveedor, encapsular SDK detrás de adapter.
- Guardar solo referencias o resultados permitidos.
- Manejar rechazo, pendiente, revisión manual y expiración.

## 8. Compras y cuotas

La app debe representar claramente:

- Monto total.
- 60% inicial.
- 40% financiado.
- 3 cuotas.
- Fechas de vencimiento.
- Estado de cada cuota.
- No acelerar deuda total por una cuota vencida.

No mostrar reglas de mora/default no definidas.

## 9. Seguridad mobile

- Tokens en SecureStore.
- No logs con PII.
- No screenshots de datos sensibles si se decide bloquear capturas en pantallas críticas.
- Validar jailbreak/root solo si el negocio lo define; no bloquear usuarios sin política aprobada.
- Rate-limit y seguridad real en backend.

## 10. Prohibido

- Guardar tokens en AsyncStorage.
- Subir contactos completos.
- Pedir permisos sensibles al abrir la app sin contexto.
- Hardcodear endpoints productivos.
- Enviar múltiples veces una compra por doble click.
- Usar mocks en producción.
