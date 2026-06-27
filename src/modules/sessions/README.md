# Módulo Sessions

Registra sesiones y señales mínimas de dispositivo usando tablas existentes del schema Atlas.

## Endpoints

- `POST /api/v1/customers/:customerId/sessions`
- `GET /api/v1/customers/:customerId/sessions`

## Reglas aplicadas

- El endpoint recibe `deviceFingerprintHash`, no fingerprint crudo.
- Se actualiza la reutilización global y por tenant del dispositivo.
- Se vincula cliente-dispositivo.
- Se crea snapshot de dispositivo si el cliente envía datos técnicos.
- La operación de creación usa transacción.
