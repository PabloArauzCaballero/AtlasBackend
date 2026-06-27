# Seeders

Esta carpeta contiene datos mínimos de desarrollo para probar que el schema migrado permite crear registros base.

## Seeder incluido

`20260626160720-seed-minimal-dev-credentials.ts` crea registros mínimos para:

- Tenant de desarrollo.
- Usuario plataforma.
- Usuarios internos.
- Cliente demo.
- Perfil, documento de identidad y contacto.
- Dispositivo y sesión.
- Consentimiento.
- Flujo de onboarding.
- Evaluación de riesgo y resultado.
- Resumen de actividad.
- Caso de revisión manual.
- Caso de fraude.
- Watchlist.
- Logs de auditoría y calidad.

## Importante

Esta fase no implementa Auth/JWT ni almacenamiento de contraseñas. Las credenciales de prueba están documentadas, pero no se guardan contraseñas en el schema actual porque no existe todavía una tabla de credenciales.
