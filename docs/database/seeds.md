# Seeders de desarrollo — Proyecto Atlas

## Alcance

Se agregó infraestructura de seeders con Umzug para cargar datos mínimos de prueba después de ejecutar las migraciones.

## Comandos

```bash
npm run db:seed:create -- seed-minimal-dev-credentials
npm run db:seed:up
npm run db:seed:down
npm run db:seed:status
```

## Seeder mínimo incluido

El seeder `seed-minimal-dev-credentials` carga una cadena mínima de datos para probar las relaciones principales del schema:

1. Tenant.
2. Usuarios plataforma e internos.
3. Cliente demo.
4. Perfil, contacto e identidad.
5. Dispositivo, link cliente-dispositivo y sesión.
6. Consentimiento y evento de consentimiento.
7. Onboarding.
8. Evaluación de riesgo y resultado.
9. Resumen de actividad.
10. Casos de revisión manual y fraude.
11. Watchlist.
12. Auditoría y calidad de datos.

## Decisión sobre contraseñas

No se creó una tabla nueva de credenciales porque esta fase sigue siendo solo ORM/migraciones/seeders y el PUML actual no define almacenamiento de contraseña.

Las contraseñas documentadas en `dev-credentials.md` quedan como valores reservados para cuando se implemente el módulo Auth/JWT.

## Riesgo pendiente

Cuando se implemente autenticación real, debe agregarse una migración explícita para credenciales, password hash, control de sesiones, refresh tokens o el mecanismo que se decida. No conviene mezclarlo dentro del schema de inteligencia/fraude sin una decisión de seguridad cerrada.
