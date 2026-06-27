# Credenciales demo para desarrollo local

Estas credenciales son valores reservados para pruebas de integración futuras. En esta fase todavía no existe módulo Auth/JWT ni tabla de contraseña, por lo tanto las contraseñas no se insertan en la base de datos.

## Usuarios sembrados

| Tipo | Usuario | Email | Contraseña reservada | Rol |
|---|---|---|---|---|
| Plataforma | `pablo.platform` | `pablo.platform@atlas.test` | `AtlasPlatform2026!` | `platform_super_admin` |
| Interno tenant | `pablo.admin` | `pablo.admin@atlas.test` | `AtlasAdmin2026!` | `tenant_admin` |
| Operaciones riesgo | `risk.ops` | `risk.ops@atlas.test` | `AtlasRisk2026!` | `risk_analyst` |
| Cliente demo | `cliente.demo` | `cliente.demo@atlas.test` | `AtlasCustomer2026!` | `customer_demo` |

## Datos técnicos del seed

| Dato | Valor |
|---|---|
| Tenant ID | `1` |
| Tenant code | `atlas-bo-dev` |
| Customer ID | `1` |
| Customer code | `CUS-DEMO-001` |
| Device ID | `1` |
| Session ID | `1` |
| Risk assessment run ID | `1` |
| Manual review case | `MR-DEMO-001` |
| Fraud case | `FR-DEMO-001` |

## Cómo cargar los datos

```bash
npm run db:migration:up
npm run db:seed:up
```

## Cómo revertirlos

```bash
npm run db:seed:down
```

## Nota de seguridad

Estas credenciales son solo para entorno local o base de pruebas. No deben usarse en producción ni exponerse en ambientes reales.
