# Convenciones de inyección: puertos, tokens y composición (AT-014)

Lo prueba `test/architecture/di-contracts.spec.ts`; lo vigila `yarn check:architecture` (un provider concreto importado
por `application/` de otro módulo es una infracción de fronteras).

## Cuatro reglas

1. **El token vive junto al puerto.** Una interfaz TypeScript no existe en runtime, así que cada puerto exporta un token
   de cadena estable (`'atlas.<contexto>.<puerto>'`): `CLOCK` en `src/platform/di/clock.ts`, `NOTIFICATION_REQUEST_PORT`
   en `src/modules/notifications/application/ports/`, `CREDIT_UNIT_OF_WORK` en `src/modules/credit/application/ports/`.
   Un `Symbol` valdría, pero la cadena se lee en el error de Nest cuando falta el provider, y eso importa.
2. **El adaptador concreto se registra en el módulo, no se importa desde el caso de uso.**
   `{ provide: TOKEN, useExisting: AdaptadorConcreto }` (o `useFactory`). El caso de uso recibe el puerto con
   `@Inject(TOKEN)`. Cambiar de adaptador (local → remoto, real → fake) es editar el módulo, no el caso de uso.
3. **Puertos pequeños, por necesidad del consumidor.** `CreditAdmissionEligibility` tiene dos métodos, no los doce de
   `CustomerEligibilityService`. `NotificationRequestPort` tiene uno. No existe `IGenericRepository<T>`.
4. **Valores, no identidad mutable, en los contratos.** Lo que cruza un puerto es serializable (`Readonly`, fechas ISO,
   ids en cadena). Un modelo Sequelize, una `Transaction` o un objeto con `.save()` no cruzan; `check:architecture` lo
   rechaza en `public/`.

## Composición

- `PlatformModule` (`@Global`) registra lo técnico que todos necesitan y ninguno posee: hoy `CLOCK`; mañana el bus de
  eventos y el contexto de petición.
- Los servicios que se construyen también a mano (harness de integración, pruebas unitarias) declaran el puerto técnico
  como `@Optional() @Inject(TOKEN) private readonly x: Port = implementacionPorDefecto`. Nest lo inyecta; `new` cae al
  valor por defecto. Es la única forma de que un cambio de firma no rompa 470 suites.
- Un `TestingModule` que compone un slice sin un provider **falla al compilar** nombrando el token
  (`Nest can't resolve dependencies … atlas.notifications.request-port`). No hay contenedor global ni service locator
  que lo tape.

## Qué NO es inversión de dependencias

- Renombrar `CustomersRepository` a `ICustomersRepository` y seguir importándolo desde `credit`.
- `forwardRef` para «resolver» un ciclo: el ciclo sigue ahí; el gate lo detecta por el grafo, no por el nombre.
- `ModuleRef.get()` dentro de un servicio: es un service locator y esconde la dependencia al grafo.

## Migración

Cada tarea de F4 que abra un puerto para su contexto sigue este orden: puerto + token en `application/ports/` →
adaptador local en `infrastructure/` → `provide` en el módulo → consumidores migran a `@Inject(TOKEN)` → la línea base
de fronteras encoge → `check:architecture --update-baseline`.
