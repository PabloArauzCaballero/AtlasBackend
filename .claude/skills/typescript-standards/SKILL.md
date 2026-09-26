---
name: typescript-standards
description: Estándar de TypeScript de la casa — `strict` completo, `unknown` en vez de `any`, uniones discriminadas con exhaustividad por `never`, tipos de marca para IDs, `satisfies`, inmutabilidad, validación en runtime en los bordes, trampas de ESM vs CJS en Node y Jest, y tipos para dinero y fechas. Usar al escribir o revisar código TypeScript (API NestJS o web Angular), configurar un `tsconfig`, tipar un DTO o respuesta externa, o cuando aparece un `any`, un `as` o un `!` para callar al compilador.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# TypeScript — estándar de la casa

El compilador es el primer revisor: cada `any`, `as` o `!` es una revisión que se saltea.
Para nombres y funciones ver `clean-code`; para diseño de clases, `solid-principles`.
Los flags exactos del proyecto viven en su `tsconfig` — este estándar fija el piso.

## 1. `tsconfig`: el piso no negociable

- `"strict": true` siempre. No se apaga ningún sub-flag (`strictNullChecks`,
  `noImplicitAny`, `strictPropertyInitialization`…) para "destrabar" un módulo.
- Sumá sobre `strict`: `noUncheckedIndexedAccess` (todo `arr[i]` y `record[k]` es
  `T | undefined`), `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `exactOptionalPropertyTypes` (distingue "ausente" de `undefined` explícito — clave en
  PATCH parciales).
- `verbatimModuleSyntax` en proyectos ESM: obliga a `import type` y emite los imports
  tal cual los escribiste.
- Un `// @ts-ignore` está prohibido; `// @ts-expect-error` solo con el motivo en la misma
  línea, y falla solo cuando el error desaparece.

## 2. `any` está prohibido como silenciador

| En vez de | Usá |
|---|---|
| `any` en dato externo (body, JSON, `catch`) | `unknown` + narrowing o schema de runtime |
| `as Foo` sobre dato no validado | parsear/validar y devolver `Foo` |
| `obj!.prop` | chequeo explícito o error temprano con mensaje |
| `as unknown as Foo` | casi siempre un bug de diseño: arreglá el tipo de origen |
| `Function`, `object`, `{}` | firma concreta, `Record<string, unknown>` |

```typescript
// ❌ el compilador ya no ve nada de acá para abajo
function handle(e: any) { return e.response.data.message; }

// ✅ unknown obliga a demostrar la forma
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String(e.message);
  return 'unknown error';
}
```

- La variable de `catch` es `unknown` (con `strict`). Nunca `catch (e: any)`.
- Un `as` legítimo se justifica en un comentario de una línea. `as const` no cuenta: es
  el bueno.

## 3. Uniones discriminadas + exhaustividad

Modelá estados excluyentes como unión con discriminante literal, no como un objeto con
muchos opcionales que permite combinaciones imposibles.

```typescript
// ❌ permite { status: 'ok', error: '...' } y { status: 'error' } sin error
interface Result { status: string; data?: Invoice; error?: string }

// ✅ cada estado trae exactamente lo suyo
type Result =
  | { status: 'ok'; data: Invoice }
  | { status: 'rejected'; reason: RejectionReason }
  | { status: 'failed'; error: DomainError };

function render(r: Result): string {
  switch (r.status) {
    case 'ok': return r.data.number;
    case 'rejected': return r.reason;
    case 'failed': return r.error.code;
    default: { const _never: never = r; return _never; } // falla al agregar un caso
  }
}
```

- El `default` con `never` es obligatorio en todo `switch` sobre una unión de dominio:
  convierte "me olvidé un estado" en error de compilación.
- Catálogos cerrados que viven en la base (value sets) **no** se duplican como `enum` de
  TS: se tipan como ID de concepto (ver `terminology-value-sets`). Para conjuntos que sí
  son del código, preferí `as const` + unión derivada a `enum`:

```typescript
export const CHANNELS = ['email', 'push', 'in_app'] as const;
export type Channel = (typeof CHANNELS)[number];
```

## 4. Tipos de marca (branded) para IDs y unidades

Dos `string` son intercambiables para el compilador; un `PatientId` y un `DoctorId` no
deberían serlo.

```typescript
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PatientId = Brand<string, 'PatientId'>;
export type TenantId = Brand<string, 'TenantId'>;

export const PatientId = (raw: string): PatientId => {
  if (!UUID_RE.test(raw)) throw new InvalidIdError('PatientId', raw);
  return raw as PatientId; // único `as` permitido: dentro del constructor validado
};
```

- Marcá IDs de agregados, identificadores de tenant, y magnitudes con unidad (centavos,
  minutos) donde mezclarlas sea un bug caro. No marques todo: el costo es fricción.

## 5. `satisfies`, `readonly` e inferencia

- `satisfies` valida contra un tipo **sin ensancharlo**: ideal para mapas de
  configuración, tablas de transición y mapeos error→HTTP, donde querés chequeo de forma
  y conservar las claves literales.

```typescript
const HTTP_BY_CODE = {
  APPOINTMENT_OVERLAP: 409,
  STALE_VERSION: 412,
} satisfies Record<ErrorCode, number>; // falta una clave → error; sobra una → error
```

- Parámetros de colección: `readonly T[]` / `ReadonlyArray<T>`. Propiedades de DTOs y
  value objects: `readonly`. Mutar un argumento es un efecto secundario oculto.
- Anotá tipos en las **fronteras** (firmas públicas, retornos exportados); dejá inferir
  adentro. Un retorno exportado sin anotar filtra detalles de implementación al contrato.

## 6. Los tipos no validan: runtime en los bordes

Un tipo es una promesa en compilación; en runtime llega cualquier cosa. Todo dato que
cruza un borde se **parsea**, no se castea:

- HTTP entrante: DTO + `ValidationPipe` (ver `nestjs-development`).
- HTTP saliente / SDK de terceros / colas / `JSON.parse` / variables de entorno / filas
  crudas de SQL: schema de runtime (la librería la define el proyecto) que devuelve el
  tipo ya validado.
- Patrón: `parseX(input: unknown): X`. Adentro del dominio se confía en `X`.

## 7. ESM vs CJS — trampas reales

- Un paquete **ESM puro** no se puede `require()`. Si el runner de tests cae a CJS, el
  síntoma es `SyntaxError: Unexpected token 'export'` — parece dependencia rota y es de
  invocación. Jest con ESM nativo necesita Node con `--experimental-vm-modules`: corré
  los tests **por el script del proyecto**, nunca por el binario a secas.
- Con `"module": "nodenext"` los imports relativos llevan extensión **`.js`** aunque el
  fuente sea `.ts`.
- En ESM no existen `__dirname`, `__filename` ni `require`: usá `import.meta.url`
  (`fileURLToPath`) e `import()` dinámico.
- `import type { X }` para todo lo que solo es tipo: evita imports circulares en runtime
  y cargas innecesarias. Con decoradores que emiten metadata, una clase usada como tipo
  inyectable **no** puede ser `import type`.
- No mezcles `export default` con exports nombrados en módulos propios: nombrados siempre.

## 8. Dinero y fechas

- Dinero: nunca `number` con decimales. Enteros en unidad mínima (`bigint`/entero
  seguro) o una librería decimal; el tipo lleva la moneda (`{ amount; currency }`). En
  JSON viaja como **string** o entero de unidad mínima, no como float. La columna es
  `numeric` (ver `database-design`).
- Fechas: un instante es `Date`/ISO-8601 con zona (UTC en tránsito y en base). Una fecha
  civil sin hora (nacimiento, vencimiento) es `YYYY-MM-DD` como string marcado, **no**
  un `Date` — si no, la zona horaria le corre el día.

## 9. Generics sin gimnasia

- Un generic se justifica si relaciona entrada con salida (`<T>(xs: T[]) => T`). Si el
  parámetro aparece una sola vez, sobra.
- Restringí siempre (`<T extends Entity>`). Tipos condicionales recursivos y template
  literal types solo en utilidades compartidas y con test de tipos; nunca en código de
  feature. Si un tipo necesita un párrafo para explicarse, simplificá el diseño.
- Preferí utilitarios estándar (`Pick`, `Omit`, `Partial`, `Required`, `Readonly`,
  `Record`, `NonNullable`, `ReturnType`, `Awaited`) a reinventarlos.

## Anti-patrones

- `any` "temporal", `as` sobre una respuesta HTTP, `!` para callar `strictNullChecks`.
- `enum` de TS duplicando un catálogo que vive en la base.
- Interfaz con diez opcionales en lugar de una unión discriminada.
- `number` para dinero; `Date` para una fecha civil.
- Apagar un flag de `strict` en vez de arreglar el tipo.
- Correr Jest por el binario y "arreglar" el error de ESM tocando dependencias.

## Checklist

- [ ] `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` activos; cero `@ts-ignore`.
- [ ] Cero `any` nuevo; `unknown` + narrowing/schema en todo dato externo.
- [ ] Cada `as` y cada `!` tiene justificación o fue eliminado.
- [ ] Estados excluyentes como unión discriminada, `switch` con `default: never`.
- [ ] IDs de agregados y tenant con tipo de marca construido por función validada.
- [ ] Mapas de configuración con `satisfies`; parámetros de colección `readonly`.
- [ ] Todo borde (HTTP, cola, env, SQL crudo, tercero) parsea a tipo, no castea.
- [ ] `import type` donde corresponde; imports relativos con `.js` si es `nodenext`.
- [ ] Dinero sin float; fechas civiles como string, instantes en UTC.
- [ ] Typecheck del proyecto en verde, con la salida pegada (ver `evidence-and-verification`).
