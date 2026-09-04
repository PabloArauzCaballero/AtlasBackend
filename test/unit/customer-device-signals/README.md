# test/unit/customer-device-signals

Pruebas de lo que en este módulo falla **en silencio**: cálculos que, si están mal, producen un dato
plausible en vez de un error.

- `device-contact-row.spec.ts` — la frontera cifrado/claro (que un nombre no acabe en una columna
  consultable), la normalización del teléfono antes de hashear (si diverge de la de la app, el cruce
  no encuentra nunca nada y sale cero), y que el recuento cuadre con los hashes (lo exige un `CHECK`
  de la tabla).
- `location-tracking.spec.ts` — el haversine contra el domicilio declarado, y la normalización de
  teléfono y correo compartida con la app móvil.
