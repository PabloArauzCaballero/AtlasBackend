# Evidencia del motor QA de personas

Aquí cae el informe de cada corrida de `scripts/qa/run-personas.ts`. Se conserva **la última**, no
el historial: una corrida intermedia documenta una iteración del motor, no un hecho del producto.

## Cómo se reproduce

```bash
# 1. Infraestructura y emulador
docker compose up -d postgres redis
MOCK_PROVIDERS_PORT=4010 MOCK_PROVIDERS_CONTROL_TOKEN=<token> \
  node ../AtlasExternalProvidersMock/src/server.mjs &

# 2. API con los proveedores apuntando al emulador
SEGIP_MODE=mock_server INFOCENTER_MODE=mock_server \
EXTERNAL_PROVIDERS_MOCK_BASE_URL=http://127.0.0.1:4010/mock \
  node dist/src/main.js &

# 3. Veinte personas por los flujos documentados
MOCK_PROVIDERS_CONTROL_TOKEN=<token> \
  npx tsx scripts/qa/run-personas.ts --personas=20 --seed=<semilla>
```

## Qué leer del informe, y en qué orden

1. **`concurrencia.maxPersonasSolapadas`.** Si es 1, no hubo concurrencia: fue un bucle secuencial
   rápido. Todo lo demás del informe es válido, pero no dice nada sobre carga.
2. **`aislamiento.sinFugaEntrePersonas`.** Dos personas con el mismo `customerId` significa que
   alguien recibió la sesión de otra. Ninguna tasa de aprobación compensa eso.
3. **`pasos.assertionPassRate` con su denominador.** Los `skippedDependency` NO están ni en el
   numerador ni en el denominador: un paso omitido no aprueba nada.
4. **`evidenciaEmulador.veredicto`.** Es lo único que el backend no puede falsificar:
   - `COHERENTE` — tantas llamadas observadas como consultas exitosas.
   - `SIN_CONTEXTO_DE_CORRIDA` — el tráfico salió, pero cayó en el namespace legacy porque el
     backend todavía no propaga `qaContext` desde una corrida autorizada.
   - `PROVEEDOR_EN_PROCESO` — los proveedores están en `mock_local`: el backend responde sin salir
     a la red y el journal vacío es lo correcto.
   - `EVIDENCIA_AUSENTE` — modo `mock_server`, consultas exitosas y cero llamadas: el tráfico no
     salió. Es el fallo que el bloque existe para atrapar.
   - `LLAMADAS_DE_MAS` — más llamadas que consultas. Sospechar de la vista previa de costo, que por
     contrato no debe ejecutar al proveedor.
5. **`admissionLag` aparte de `latenciaHttp`.** El primero es la espera en la compuerta que respeta
   el límite de tasa del backend; sumarlos diría que el alta tarda un minuto.
6. **`latenciaHttp.insufficientSamples`.** Con menos de 30 muestras, los percentiles se publican
   etiquetados. Un p99 sobre diez peticiones se pinta igual de convincente y no dice nada.

## Lo que el informe NO afirma

Que Atlas soporte veinte personas. Veinte es el número que se corrió, no un umbral medido: el
generador y el objetivo estaban en la misma máquina, y eso distorsiona cualquier conclusión de
capacidad. Para hablar de capacidad hace falta topología declarada y muestras suficientes.
