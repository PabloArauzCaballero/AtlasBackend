# mobile-welcome-audio

La voz de la marca en el momento en que alguien entra a la app.

Al terminar el login, el móvil pide aquí la locución de bienvenida. Este módulo la encarga al
**worker de locución del motor de decisión** (`/v1/workers/audio-tts`), que la sintetiza con
ElevenLabs a partir de una **plantilla del catálogo** —`onboarding.welcome.named`, con la variable
`{{name}}`— y la sirve ya generada.

## Lo que hay que entender antes de tocarlo

**El nombre no viene del móvil.** Se lee del perfil vigente del cliente autenticado. Si viniera del
cuerpo de la petición, este endpoint sería un sintetizador de texto a voz de uso libre pagado por el
inquilino, y cualquiera podría poner cualquier frase en boca de la marca. El catálogo de plantillas
del motor existe precisamente para que eso no sea posible; aceptar texto lo anularía.

**Cada locución nueva cuesta dinero.** El motor cachea por contenido y voz —la segunda vez que se
saluda a una Valeria no se sintetiza nada— pero el primer saludo de cada nombre distinto es una
llamada facturada. De ahí el tope de tres por minuto y la credencial propia
(`DECISION_ENGINE_AUDIO_API_KEY`), que se puede revocar sin tocar consentimientos ni desenlaces.

**Nada de esto puede impedir entrar.** Un worker apagado, una cuota agotada, un motor caído: todos
terminan en `UNAVAILABLE`, que el móvil trata como «entra en silencio». Un saludo no es una función
del producto, es un detalle; convertirlo en una pantalla de error encima de la app recién abierta
sería mucho peor que no tenerlo.

## Los tres endpoints

| | |
|---|---|
| `POST /mobile/welcome-audio` | Encarga la locución. No recibe nada. Devuelve `requestId`. |
| `GET /mobile/welcome-audio/:requestId` | `PENDING` · `READY` · `UNAVAILABLE`. |
| `GET /mobile/welcome-audio/:requestId/audio` | Los bytes, bajo la sesión de quien los pidió. |

Son tres y no uno porque sintetizar tarda segundos: un endpoint que esperara al audio colgaría la
petición justo durante el arranque de la app.

## Configuración

    DECISION_ENGINE_BASE_URL=...
    DECISION_ENGINE_AUDIO_API_KEY=...          # si falta, cae a DECISION_ENGINE_GOVERNANCE_API_KEY
    DECISION_ENGINE_WELCOME_TEMPLATE=onboarding.welcome.named
    DECISION_ENGINE_WELCOME_FALLBACK_TEMPLATE=onboarding.welcome.generic

Y en el motor, el worker encendido de verdad:

    AUDIO_TTS_WORKER_ENABLED=true
    AUDIO_TTS_PROVIDER=elevenlabs
    AUDIO_TTS_ALLOW_RUNTIME_GENERATION=true
    ELEVENLABS_API_KEY=...
    ELEVENLABS_VOICE_ID=...

Sin `AUDIO_TTS_ALLOW_RUNTIME_GENERATION` el worker sólo sirve lo que ya está en caché: los saludos
de nombres nuevos se quedan en `PENDING` para siempre. Es un permiso aparte a propósito —generar
durante la operación es lo que gasta presupuesto—, y hay que darlo explícitamente.

## Comprobado contra el stack local (24-08-2026)

Con el motor en `localhost:3020` (contenedor `atlas-decision-engine-api-1`) y una instancia de este
backend levantada aparte en el 3055 —para no tocar el contenedor que estaba sirviendo la demo—:

    POST /api/v1/mobile/welcome-audio          → 202  {"requestId":"2a7a…","status":"READY"}
    GET  /api/v1/mobile/welcome-audio/2a7a…    → 200  {"status":"READY"}
    GET  /api/v1/mobile/welcome-audio/2a7a…/audio
        → 200 · Content-Type: audio/mpeg · Cache-Control: no-store, private · 554 bytes

    GET  …/00000000-0000-4000-8000-0000000000ff → 404 WELCOME_AUDIO_NOT_FOUND
    GET  …/..%2Fetc                             → 400 VALIDATION_ERROR
    POST sin Authorization                      → 401 UNAUTHORIZED

Los 554 bytes de esa primera corrida eran del proveedor **`fake`**, que es el que trae
`docker-compose.yml` por defecto (`AUDIO_TTS_PROVIDER: ${AUDIO_TTS_PROVIDER:-fake}`): un mp3 con
cabecera ID3 y nada dentro. Sirvió para comprobar la cadena —plantilla, caché por contenido,
permiso, transporte— pero no suena.

## Con voz real (25-08-2026)

Con `AUDIO_TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID` puestos en el
`.env` del motor y sus contenedores recreados:

    POST /api/v1/mobile/welcome-audio   → 202 PENDING   (≈15 s la primera vez; instantáneo en caché)
    GET  …/{id}                         → READY
    GET  …/{id}/audio                   → 200 · audio/mpeg · 48.527 bytes · 2,96 s

Y el mismo archivo aparece en la caché del simulador después de ingresar desde la app —
`Library/Caches/atlas-bienvenida-{id}.mp3`—, que es la prueba de que la cadena llega hasta el
teléfono. La evidencia está en
`AtlasFrontend/apps/consumer-app/docs/evidence/2026-08-24-arranque-cinematografico/`.

**La voz se eligió por descarte, no por gusto.** La cuenta es de plan gratuito y el proveedor
rechaza las voces de biblioteca con `402 paid_plan_required`; `EXAVITQu4vr4xnSDxMaL` es de las pocas
que acepta. Elegir la voz definitiva es una decisión de marca **y además invalida toda la caché de
locuciones**, porque la identidad de la voz entra en la clave del asset: el día que se cambie, todos
los saludos ya locutados se vuelven a generar y a pagar.

### Dos cosas que sólo se vieron probando de verdad

1. **El motor tarda mucho más de lo que tarda una decisión.** Encolar una locución respondió entre
   uno y catorce segundos —consulta caché por contenido, presupuesto y cuota antes de contestar—
   mientras que una decisión de crédito baja del segundo. Con los 10 s de
   `DECISION_ENGINE_TIMEOUT_MS` la mitad de las llamadas se abortaban por timeout. De ahí
   `DECISION_ENGINE_AUDIO_TIMEOUT_MS`, con 25 s por defecto.
2. **Un 500 del motor llegaba al móvil como 500.** El motor devolvió una vez
   `500 Connection terminated` —un tropiezo del pool de su base de datos— y este endpoint lo
   reenvió tal cual: una app recién abierta recibiendo un error del servidor por un saludo, y la
   monitorización llenándose de 500 por algo cosmético. Ahora `start()` degrada a `UNAVAILABLE`,
   igual que ya hacían `get()` y `audio()`.

## Qué limita el gasto, en realidad

Comprobado leyendo el motor, porque el nombre de las variables engaña:

- **`AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY` NO se aplica aquí.** Ese tope sólo entra cuando la
  solicitud trae `actorId`, y ni este módulo ni el controlador del worker lo mandan. Conviene saberlo
  antes de confiar en él: no es que esté puesto en un número alto, es que no se evalúa.
- **Lo que de verdad acota es `AUDIO_TTS_MONTHLY_BUDGET_UNITS`** menos `AUDIO_TTS_SAFETY_RESERVE_UNITS`
  — por omisión 10.000 − 1.000 = 9.000 caracteres al mes. Un saludo son unos 50, y los nombres
  repetidos salen de caché sin costar nada, así que dan para unos 180 nombres distintos al mes. Al
  agotarse, las locuciones nuevas se deniegan y el móvil recibe `UNAVAILABLE`: nadie se queda fuera
  de la app, simplemente deja de haber saludo.
- **Y el tope de este controlador**, 3 peticiones por minuto y cliente, que es lo que corta un bucle
  antes de que llegue al presupuesto.

Encima de todo eso está el plan de la cuenta de ElevenLabs, que tiene su propio límite mensual de
caracteres y es el primero que se agota si el presupuesto del motor se sube sin mirar.
