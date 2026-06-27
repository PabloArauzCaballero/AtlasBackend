# Frontend Web Development Context — Atlas Web

## 1. Stack obligatorio

- Next.js 15 con App Router.
- TypeScript strict.
- Tailwind CSS.
- shadcn/ui + Radix UI.
- lucide-react para iconos.
- recharts para gráficos.
- sonner para toasts.
- date-fns para fechas.
- Zod para validación local cuando aplique.
- `fetch` encapsulado en `apiClient`; no usar axios salvo aprobación explícita.

## 2. Alcance web

Atlas Web tiene dos áreas principales:

1. **Portal del comercio**
   - Ventas financiadas.
   - Compras y cuotas asociadas al comercio.
   - Liquidaciones.
   - Conciliación.
   - Usuarios del comercio.

2. **Panel interno de operaciones**
   - Usuarios y consumidores.
   - Comercios.
   - KYC.
   - Compras, cuotas, pagos y mora.
   - Scoring y riesgo.
   - Auditoría.
   - Reportes.

No mezclar permisos de comercio con permisos internos. El UI puede compartir componentes, pero los datos y capacidades deben estar separados.

## 3. Estructura recomendada

```txt
apps/web/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (merchant)/
│   │   ├── (operations)/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── guards/
│   │   ├── merchant/
│   │   └── operations/
│   ├── services/
│   ├── hooks/
│   ├── contexts/
│   ├── stores/
│   ├── lib/
│   │   ├── apiClient.ts
│   │   ├── money.ts
│   │   ├── dates.ts
│   │   └── errors.ts
│   ├── config/
│   ├── types/
│   ├── i18n/
│   └── middleware.ts
└── README.md
```

## 4. Regla de capas

```txt
app/pages -> components -> hooks/contexts -> services -> lib/apiClient
```

- Pages componen pantalla y layout.
- Components renderizan UI.
- Hooks manejan estado y efectos.
- Services llaman endpoints.
- `apiClient` es el único archivo que llama la red.

Prohibido llamar `fetch` directamente desde componentes o páginas.

## 5. Servicios

Un archivo por dominio:

```txt
services/purchase_service.ts
services/merchant_settlement_service.ts
services/risk_scoring_service.ts
```

Patrón:

```ts
class PurchaseService {
  async listMerchantPurchases(query: PurchaseListQuery): Promise<PurchaseListResponse> {
    return apiClient.get('/purchases', { query, requireAuth: true });
  }
}

const purchaseService = new PurchaseService();
export default purchaseService;
```

## 6. apiClient

`apiClient` debe manejar:

- Base URL por ambiente.
- Access token.
- Refresh token si aplica.
- `X-Request-Id`.
- Contexto de comercio activo si aplica.
- Manejo uniforme de errores.
- Redirección a login al fallar sesión.
- Serialización de query params.

No construir headers de auth a mano fuera de `apiClient`.

## 7. Auth, roles y permisos

- El UI debe ocultar acciones no permitidas, pero la seguridad real vive en backend.
- Usar `PermissionGuard` o patrón equivalente.
- Separar permisos de comercio e internos.
- No confiar en datos del cliente para decisiones críticas.

## 8. Formularios

- Validar del lado cliente para UX.
- Backend sigue siendo fuente de verdad.
- Usar Zod o validación consistente.
- Mostrar errores específicos sin filtrar información sensible.

## 9. UI y lenguaje

- Identificadores técnicos en inglés.
- Texto visible al usuario mediante i18n.
- Idioma inicial: español Bolivia (`es-BO`).
- No hardcodear strings de UI en componentes grandes si se prevé multi-idioma.
- Montos en BOB formateados consistentemente.
- Fechas claras, con zona horaria definida por backend/negocio.

## 10. Estados de pantalla

Toda pantalla que consume API debe manejar:

- Loading.
- Empty state.
- Error state.
- Success state.
- Permission denied.
- Session expired.

## 11. Tablas y reportes

En operaciones, las tablas deben incluir:

- Filtros claros.
- Paginación server-side.
- Búsqueda controlada.
- Exportación solo con permiso.
- Evitar cargar datos masivos en cliente.

## 12. Seguridad frontend

- No guardar tokens en lugares inseguros si existe alternativa aprobada.
- No exponer secrets en `NEXT_PUBLIC_*`.
- No mostrar PII innecesaria.
- Enmascarar documentos, teléfonos y datos sensibles.
- Registrar errores técnicos en observabilidad, no en pantalla final.

## 13. Prohibido

- Redux/Zustand/React Query/SWR sin aprobación.
- axios sin aprobación.
- MUI/styled-components sin aprobación.
- Componentes gigantes con data fetching, lógica y UI mezcladas.
- `any` como escape permanente.
- Desactivar ESLint/TypeScript para hacer pasar build.
- Usar datos mock en producción.
