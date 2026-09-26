---
name: solid-principles
description: Los cinco principios SOLID (SRP, OCP, LSP, ISP, DIP) con el síntoma que delata cada violación, un ejemplo de refactor en TypeScript y cuándo NO aplicarlos para evitar sobre-ingeniería. Usar al diseñar una clase o módulo nuevo, al revisar si una jerarquía de herencia o una interfaz gigante necesita partirse, o al decidir entre herencia y composición. Complementa a `clean-code` (nivel función/nombre) y a `design-patterns` cuando el principio pide una abstracción con nombre.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# SOLID — guía de decisión

SOLID no es un fin en sí mismo: es una respuesta a **código que cuesta cambiar**. Cada
principio existe para que un tipo concreto de cambio futuro sea barato. Aplicalo cuando
el dolor que resuelve ya es visible o es casi seguro que va a aparecer — no por adelantado
sobre código que probablemente no vuelva a cambiar.

## Tabla síntoma → principio

| Síntoma en el código | Principio | Qué falla |
|---|---|---|
| Una clase cambia por razones de negocio no relacionadas entre sí | SRP | Más de una responsabilidad |
| Para agregar un caso nuevo hay que editar un `switch`/`if-else` ya existente | OCP | No está cerrado a modificación |
| Una subclase lanza `NotImplementedError` o ignora un método del padre | LSP | La subclase no es sustituible |
| Una clase implementa una interfaz y deja media docena de métodos vacíos | ISP | Interfaz demasiado ancha |
| Una clase de alto nivel importa directamente una librería/framework concreto | DIP | Depende de un detalle, no de una abstracción |

## S — Single Responsibility Principle
Una clase/módulo tiene una sola razón para cambiar (un solo "actor" o stakeholder que
la motiva a cambiar) — no es "haga una sola cosa" en sentido literal de una función.

**Síntoma**: `UserService` que valida reglas de negocio, arma el SQL, formatea el email
de bienvenida y escribe el log de auditoría. Cambia el formato del email → hay que
tocar la misma clase que valida contraseñas.

```ts
// ❌ tres razones de cambio en una clase: negocio, persistencia, notificación
class UserService {
  register(input: RegisterInput) {
    if (input.password.length < 8) throw new Error('weak password');
    db.query('INSERT INTO users ...', input);
    mailer.send(input.email, 'Bienvenido');
  }
}

// ✅ una razón por clase
class PasswordPolicy { isValid(password: string): boolean { return password.length >= 8; } }
class UserRepository { save(user: RegisterInput): Promise<void> { /* SQL */ } }
class WelcomeNotifier { notify(email: string): Promise<void> { /* envío */ } }
```

**No apliques SRP si**: la clase es un DTO/value object sin comportamiento, o el split
solo introduce dos clases que siempre cambian juntas por la misma razón (eso es
fragmentación, no separación de responsabilidades).

## O — Open/Closed Principle
Abierto a extensión, cerrado a modificación: agregar un comportamiento nuevo no debería
requerir editar el código que ya funciona y ya está probado.

**Síntoma**: un `switch (type)` que crece cada vez que aparece un caso de negocio nuevo,
repetido en varios lugares del código.

```ts
// ❌ cada tipo de pago nuevo obliga a tocar esta función
function calculateFee(payment: Payment): number {
  switch (payment.type) {
    case 'card': return payment.amount * 0.029;
    case 'transfer': return 1.5;
    default: throw new Error('unknown type');
  }
}

// ✅ extensible sin tocar el código existente
interface FeeStrategy { calculate(amount: number): number; }
class CardFee implements FeeStrategy { calculate(amount: number) { return amount * 0.029; } }
class TransferFee implements FeeStrategy { calculate(): number { return 1.5; } }
// un mapa/factory conecta payment.type -> FeeStrategy
```

**No apliques OCP si**: solo hay un caso hoy y no hay evidencia de que vengan más — un
`if` simple es más legible que una jerarquía de estrategias con un solo miembro.

## L — Liskov Substitution Principle
Un objeto de una subclase debe poder reemplazar a uno de la clase base sin romper la
corrección del programa: mismas precondiciones (no más estrictas) y mismas
poscondiciones (no más débiles) que el contrato del padre.

**Síntoma clásico**: `Square extends Rectangle` y sobreescribe `setWidth`/`setHeight`
para mantener lados iguales — rompe cualquier código que asuma que `setWidth` no toca
`height`.

```ts
// ❌ Square viola el contrato implícito de Rectangle
class Rectangle {
  constructor(protected width: number, protected height: number) {}
  setWidth(w: number) { this.width = w; }
  area() { return this.width * this.height; }
}
class Square extends Rectangle {
  setWidth(w: number) { this.width = w; this.height = w; } // sorpresa para quien llama
}

// ✅ sin jerarquía forzada; ambos implementan un contrato común más chico
interface Shape { area(): number; }
class Rectangle implements Shape { constructor(private w: number, private h: number) {} area() { return this.w * this.h; } }
class Square implements Shape { constructor(private side: number) {} area() { return this.side ** 2; } }
```

**No apliques LSP como excusa** para prohibir toda herencia: si las subclases realmente
comparten contrato e invariantes (mismas precondiciones/poscondiciones), la herencia es
válida y más simple que forzar una interfaz.

## I — Interface Segregation Principle
Ningún cliente debería depender de métodos que no usa. Muchas interfaces chicas y
específicas por rol de cliente, en vez de una interfaz gigante "todo en uno".

**Síntoma**: una interfaz `Worker` con `work()` y `eat()`, implementada por un `RobotWorker`
que tiene que poner `eat()` vacío o lanzar `NotSupportedError`.

```ts
// ❌ implementación forzada a un método que no le aplica
interface Worker { work(): void; eat(): void; }
class RobotWorker implements Worker {
  work() { /* ... */ }
  eat(): never { throw new Error('robots no comen'); }
}

// ✅ interfaces separadas por capacidad
interface Workable { work(): void; }
interface Eatable { eat(): void; }
class RobotWorker implements Workable { work() { /* ... */ } }
class HumanWorker implements Workable, Eatable { work() { /* ... */ } eat() { /* ... */ } }
```

**No apliques ISP si** termina generando media docena de interfaces de un solo método
que nadie usa por separado — el costo de indirección supera al beneficio.

## D — Dependency Inversion Principle
Los módulos de alto nivel (política/negocio) no dependen de los de bajo nivel
(detalles: HTTP, ORM, filesystem); ambos dependen de una abstracción. La abstracción no
depende de detalles; los detalles dependen de la abstracción.

**Síntoma**: un caso de uso que importa el cliente HTTP concreto o el ORM directamente,
en vez de una interfaz que el caso de uso define y el detalle implementa.

```ts
// ❌ el caso de uso depende del detalle concreto (Stripe)
class CheckoutUseCase {
  private stripe = new StripeClient(apiKey);
  charge(amount: number) { return this.stripe.charge(amount); }
}

// ✅ el caso de uso depende de una abstracción propia; Stripe la implementa
interface PaymentGateway { charge(amount: number): Promise<void>; }
class StripeGateway implements PaymentGateway { charge(amount: number) { /* SDK de Stripe */ } }
class CheckoutUseCase {
  constructor(private readonly gateway: PaymentGateway) {}
  charge(amount: number) { return this.gateway.charge(amount); }
}
```

**No apliques DIP si** el "detalle" es estable, no se va a testear con un doble y no hay
un segundo proveedor imaginable — envolver `Math` o `Date` en una interfaz porque sí es
indirección sin beneficio.

## Composición sobre herencia
Preferí componer objetos pequeños (inyectar colaboradores) antes que construir árboles
de herencia profundos para reusar código. La herencia acopla la subclase a los detalles
internos del padre (rompe encapsulamiento) y una jerarquía de 3+ niveles es casi siempre
señal de que un rol debería ser una interfaz inyectada, no una superclase. Reservá la
herencia para relaciones "es-un" verdaderas con contrato estable (ver LSP); para
"tiene la capacidad de", componé.

## Anti-sobre-ingeniería
- No introduzcas una interfaz con una sola implementación "por si el día de mañana
  cambia" sin una señal concreta de que va a cambiar (segundo proveedor, test doble real).
- No conviertas un `if` de dos ramas en un patrón Strategy con clases y factory.
- SOLID sirve al cambio futuro; si el costo de la abstracción hoy es mayor que el
  cambio que evita, no la hagas — dejá una nota y aplicá YAGNI.

## Checklist
- [ ] Cada clase se puede describir en una frase, sin "y"/"o"/"pero".
- [ ] Agregar un caso de negocio nuevo no obliga a editar un `switch` existente en más de un lugar centralizado.
- [ ] Ninguna subclase deja métodos heredados vacíos o lanza `NotImplemented`.
- [ ] Ninguna interfaz obliga a implementar métodos que la mayoría de sus clientes no usa.
- [ ] El código de negocio depende de interfaces propias, no de SDKs/ORMs importados directamente.
- [ ] Cada abstracción tiene una razón de cambio real hoy, no especulativa.
