# Backend Development Context — Atlas API

## 1. Stack obligatorio

- Node.js LTS.
- NestJS.
- TypeScript strict.
- Sequelize con `@nestjs/sequelize` y `sequelize-typescript`.
- PostgreSQL.
- Zod para validación de entrada.
- JWT para auth.
- Guards para autenticación/autorización.
- Pipes para validación.
- Filters para errores.
- Interceptors para respuesta, logging y trazabilidad cuando aporte valor.
- Swagger/OpenAPI para documentación.
- Jest para pruebas.
- ESLint + Prettier.

No usar Express puro, FastAPI, Prisma, TypeORM, raw Node, rutas manuales ni JavaScript plano salvo aprobación explícita.

## 2. Principios backend Atlas

- Monolito modular, no microservicios de día 1.
- Cada módulo representa un dominio de negocio.
- Controllers delgados.
- Services con casos de uso y reglas de negocio.
- Repositories encapsulan Sequelize.
- Models representan persistencia, no contratos públicos.
- Mappers transforman modelos internos a DTOs seguros.
- Zod valida toda entrada externa.
- JWT se encapsula en servicios/guards, nunca en controllers.
- Las operaciones financieras son auditables e idempotentes.
- Las integraciones externas se encapsulan detrás de adapters/providers.

## 3. Estructura recomendada

```txt
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.ts
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── security.config.ts
│   │   └── README.md
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── models/
│   │   ├── migrations/
│   │   ├── seeders/
│   │   └── README.md
│   ├── common/
│   │   ├── decorators/
│   │   ├── errors/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── pipes/
│   │   ├── persistence/
│   │   ├── types/
│   │   └── utils/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── consumers/
│   │   ├── merchants/
│   │   ├── kyc/
│   │   ├── consents/
│   │   ├── credit-lines/
│   │   ├── purchases/
│   │   ├── installment-plans/
│   │   ├── payments/
│   │   ├── merchant-settlements/
│   │   ├── risk-scoring/
│   │   ├── fraud/
│   │   ├── collections/
│   │   ├── notifications/
│   │   ├── audit/
│   │   └── operations/
│   └── workers/
│       ├── notification-worker.ts
│       ├── settlement-worker.ts
│       ├── scoring-worker.ts
│       └── README.md
├── test/
├── docs/
│   ├── endpoints/
│   └── architecture/
├── package.json
└── README.md
```

La estructura real puede variar si ya existe repo, pero la separación de responsabilidades no debe romperse.

## 4. Módulo estándar

```txt
modules/{domain}/
├── {domain}.module.ts
├── {domain}.controller.ts
├── {domain}.service.ts
├── {domain}.repository.ts
├── {domain}.model.ts
├── {domain}.schemas.ts
├── {domain}.dtos.ts
├── {domain}.types.ts
├── {domain}.mapper.ts
├── {domain}.constants.ts
├── README.md
└── tests/
    ├── {domain}.service.spec.ts
    └── {domain}.controller.spec.ts
```

Para módulos complejos, se puede dividir internamente:

```txt
risk-scoring/
├── services/
├── repositories/
├── strategies/
├── models/
├── schemas/
├── dtos/
└── mappers/
```

No crear subcapas decorativas si no reducen complejidad real.

## 5. Controllers

Los controllers solo deben:

- Exponer rutas HTTP.
- Aplicar guards y pipes.
- Recibir DTOs validados.
- Llamar services.
- Devolver respuestas normalizadas.

No deben:

- Consultar Sequelize.
- Firmar/verificar JWT manualmente.
- Hashear contraseñas.
- Calcular cuotas.
- Decidir scoring.
- Manejar transacciones.
- Tener reglas de negocio complejas.

Ejemplo de estilo:

```ts
@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles('merchant_operator', 'internal_operator')
  @UsePipes(new ZodValidationPipe(createPurchaseSchema))
  create(@Body() body: CreatePurchaseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.purchasesService.createPurchase(body, user);
  }
}
```

## 6. Services

Los services implementan casos de uso. Deben:

- Aplicar reglas del dominio.
- Coordinar repositories.
- Manejar transacciones si hay varias escrituras críticas.
- Emitir eventos internos cuando corresponda.
- Lanzar errores de negocio claros.
- Ser testeables sin HTTP.

Ejemplos de casos Atlas:

- `registerConsumer`
- `submitKycVerification`
- `evaluateCreditLine`
- `createPurchaseWithInstallmentPlan`
- `confirmInitialPayment`
- `registerInstallmentPayment`
- `markInstallmentOverdue`
- `payMerchantForDefaultedInstallment`
- `createMerchantSettlement`
- `recordCreditLimitMovement`

## 7. Repositories y Sequelize

- Toda persistencia va por repositories.
- Los repositories usan modelos Sequelize y devuelven modelos o entidades internas controladas.
- No exponer modelos Sequelize directamente al cliente.
- No usar `sequelize.sync()` para producción.
- No usar SQL crudo salvo necesidad clara y documentada.
- Usar transacciones Sequelize para operaciones financieras compuestas.
- Toda query debe estar correctamente acotada por usuario, comercio, operación, rol o contexto.

### Multi-tenancy / scoping correcto para Atlas

Los prompts antiguos imponían `_tenant_id` universal. Para Atlas eso no debe aplicarse automáticamente si el schema no lo define.

Regla correcta:

- En MVP, aislar por `consumerId`, `merchantId`, `operatorRole`, ownership y permisos.
- Si se decide white-label o multi-tenant real, agregar `tenantId` de forma explícita en el modelo de datos.
- No agregar `tenantId` a ciegas si contradice el schema aprobado.

## 8. Migraciones y seeders

- Cada cambio de schema debe ir en migración.
- Los seeders deben ser mínimos, seguros y útiles para probar localmente.
- Nunca commitear datos reales.
- No escribir migraciones destructivas sin fase de transición y aprobación.
- No editar migraciones ya aplicadas en ambientes compartidos.

Campos recomendados si el schema no define otro estándar:

- `id` o `uuid` según decisión del schema.
- `created_at`.
- `updated_at`.
- `deleted_at` solo en entidades administrativas que admiten soft delete.

En tablas financieras/auditoría:

- Preferir append-only.
- Usar reversos, ajustes o movimientos compensatorios.
- No borrar pagos, cuotas, compras, liquidaciones ni movimientos de línea.

## 9. Validación con Zod

- Todo body/query/params externo se valida con Zod.
- DTOs pueden inferirse desde schemas.
- Mensajes de error no deben filtrar datos sensibles.
- Validar moneda, montos, fechas, estados, ids y enums.
- Montos deben manejarse como enteros menores de moneda cuando sea posible o `DECIMAL` con precisión controlada en DB.

Ejemplo:

```ts
export const createPurchaseSchema = z.object({
  merchantId: z.string().uuid(),
  consumerId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  currency: z.literal('BOB'),
  productType: z.enum(['BNPL_STANDARD']),
});

export type CreatePurchaseDto = z.infer<typeof createPurchaseSchema>;
```

## 10. Auth y seguridad

- JWT access token corto.
- Refresh token con rotación y revocación.
- Contraseñas con Argon2id o bcrypt con coste apropiado.
- Secrets solo por variables de entorno/Secrets Manager.
- RBAC + permisos granulares.
- Rate limiting en auth, KYC, scoring y endpoints sensibles.
- Auditoría para acciones administrativas y financieras.
- CORS restringido por ambiente.
- Helmet/security headers.
- No exponer stack traces en producción.

Roles iniciales sugeridos si el usuario no entrega otros:

- `consumer`
- `merchant_admin`
- `merchant_operator`
- `internal_admin`
- `internal_operator`
- `risk_analyst`
- `collections_agent`
- `support_agent`

Si los roles definitivos son parte del requerimiento, pedir confirmación antes de fijarlos.

## 11. Reglas BNPL en backend

### Compra estándar

Al crear una compra BNPL estándar:

- Validar comercio activo.
- Validar consumidor activo y KYC/consentimientos requeridos.
- Validar línea de crédito suficiente.
- Registrar snapshot de score/riesgo/cohorte/modelo/reglas.
- Registrar monto total.
- Registrar pago inicial esperado del 60%.
- Crear plan de 3 cuotas sobre el 40% restante.
- Registrar tipo de producto financiero.
- Registrar movimiento de línea de crédito.
- Auditar todo el flujo.

No confirmar compra final si el pago inicial del 60% todavía no fue comprobado, salvo que la política explícita lo permita.

### Mora

- No acelerar deuda completa por una cuota vencida.
- Cada cuota conserva su fecha original.
- Si Atlas cubre al comercio, registrar obligación de recobro al cliente por esa cuota específica.
- Registrar estados y transiciones con fecha, actor y razón.

## 12. Scoring, fraude y riesgo

El scoring debe ser versionado y auditable.

Guardar, como mínimo cuando aplique:

- `modelVersion` o `rulesetVersion`.
- Score final.
- Nivel de riesgo.
- Variables agregadas usadas, sin PII innecesaria.
- Reason codes entendibles.
- Decisión: aprobado, rechazado, revisión manual, pendiente.
- Overrides manuales con usuario, fecha y motivo.

No usar modelos black-box sin explicación operativa para decisiones de crédito.

## 13. KYC y biometría

- Integrar proveedores por adapter.
- No guardar biometría cruda si no hay política explícita.
- Guardar referencias, resultado, timestamps, consentimiento, versión del proveedor y evidencia mínima necesaria.
- Toda decisión KYC debe ser auditable.

## 14. Workers

Los workers deben ser procesos persistentes de larga duración, separados del HTTP API.

Reglas:

- No depender de endpoints para activarse.
- Consumir colas/eventos continuamente.
- Manejar errores sin matar el proceso completo.
- Tener logs de inicio, procesamiento, error y apagado.
- Tener apagado controlado.
- Respetar concurrencia.
- Usar reintentos controlados.
- Ser idempotentes.

Casos Atlas:

- Envío de SMS/WhatsApp/push.
- Reintentos de conciliación.
- Procesamiento de scoring diferido.
- Alertas de mora.
- Liquidaciones.
- Reportes.

## 15. Estados

No inventar estados si el diagrama o schema los define. Si no están definidos, proponerlos como borrador y pedir validación.

Para entidades financieras, documentar transiciones en `docs/architecture/flows.md`.

## 16. Documentación backend obligatoria

Cada módulo relevante debe tener README con:

- Responsabilidad.
- Entidades/tablas involucradas.
- Endpoints.
- Permisos.
- Estados.
- Reglas de negocio.
- Errores comunes.
- Comandos de prueba.

Además:

```txt
docs/endpoints/openapi.yaml
docs/endpoints/endpoints.md
docs/architecture/architecture.md
docs/architecture/flows.md
docs/architecture/assumptions.md
```

## 17. Prohibido

- `src/app.ts` y `src/server.ts` estilo Express si se usa NestJS.
- `express.Router()`.
- Controllers genéricos gigantes.
- Repositories con reglas de negocio.
- Services que devuelven contraseñas, tokens internos o campos sensibles.
- `any` sin justificación.
- `console.log` en producción.
- `.env` real en repo.
- Migraciones sin revisión.
- Borrar registros financieros.
- Guardar contactos completos del usuario.
