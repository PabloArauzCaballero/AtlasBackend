# Prompt frontend web Atlas — Next.js

Usa Next.js 15 App Router + TypeScript strict + Tailwind + shadcn/ui.

## Capas

- `app/` compone rutas.
- `components/` renderiza UI.
- `hooks/` maneja estado y efectos.
- `services/` llama API.
- `lib/apiClient.ts` es el único que usa red.

## Áreas

- Portal comercio.
- Panel operaciones.

No mezcles permisos. No llames `fetch` desde componentes.

## UI

- i18n con español Bolivia inicial.
- Montos en BOB.
- Loading/empty/error/success en toda pantalla.
- Paginación server-side para tablas.
- Enmascarar PII.
