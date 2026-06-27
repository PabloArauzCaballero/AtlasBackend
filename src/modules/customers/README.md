# Módulo Customers

Implementa los primeros endpoints de negocio para registro y consulta segura de cliente.

## Endpoints

- `POST /api/v1/customers/register`
- `GET /api/v1/customers/:customerId/summary`

## Reglas aplicadas

- No almacena teléfono ni email en claro.
- Guarda hashes SHA-256, últimos 4 dígitos de teléfono y dominio de email.
- Crea perfil versionado inicial.
- Crea evento de estado inicial.
- Usa transacción Sequelize para el registro completo.

## Qué no implementa todavía

- Login.
- Contraseñas.
- KYC documental.
- Línea de crédito.
- Compra BNPL.
- Scoring automático.
