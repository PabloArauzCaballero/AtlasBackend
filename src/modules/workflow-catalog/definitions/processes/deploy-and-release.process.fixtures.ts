/**
 * @file Proceso declarado en código: Despliegue y release: Actions → Coolify (dev), rama test (Contabo), migraciones al desplegar, verificación desde la red de Pablo.
 * @business Un cambio sólo está «desplegado» cuando el servicio nuevo responde con su cuerpo correcto, sus migraciones están aplicadas y se abre desde la red de quien lo prueba; este proceso encadena esos pasos y dice qué comprobar en cada uno.
 * @system fixture P-38 que `syncWorkflowCatalog` vuelca a `workflow_*`; `.github/workflows/deploy-dev.yml` (Tailscale → API de Coolify), job `migrate` de `docker-compose.coolify.yml`, `scripts/post-deploy-smoke.mjs`, `_herramientas/comprobar-desde-mi-red.sh`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** `INTERNAL_PORTAL_ROLES` de `internal-portal.controller.ts`. */
const PORTAL = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
];

export const DEPLOY_AND_RELEASE: WorkflowDefinitionFixture = {
  processId: 'P-38',
  code: 'deploy_and_release',
  version: 'v1',
  name: 'Despliegue y release: Actions → Coolify (dev), rama test (Contabo), migraciones al desplegar, verificación desde la red de Pablo',
  description:
    'De un push a dev al servicio comprobado: el workflow deploy-dev.yml entra por Tailscale a Coolify del H310 y espera a que el despliegue termine en finished, el job migrate aplica las migraciones, el smoke comprueba liveness, readiness y el commit servido, la rama test se adelanta desde origin/dev para el Coolify de Contabo, y la última palabra la da la comprobación desde la red de Pablo.',
  processType: 'system_job',
  ownerDomain: 'platform',
  ownerRole: 'SYSTEMS_ADMIN',
  priority: 'P2',
  systems: ['ATLAS_BACKEND', 'DECISION_ENGINE', 'ERP_BACKEND', 'DASHBOARDS'],
  narrative: {
    whyExists:
      'El verde de GitHub no significaba desplegado: el workflow terminaba a los 10 s aunque el build muriera a los veinte minutos y el contenedor viejo siguiera sirviendo. Hace falta una cadena que sólo dé por hecho un despliegue cuando el servicio nuevo responde con su cuerpo y su commit, y se abre desde donde Pablo prueba.',
    whoStartsAndCloses:
      'Lo inicia una persona o sesión al empujar a dev (o origin/dev:test) con sus rutas; lo ejecutan GitHub Actions y Coolify, y lo cierra el smoke con el commit correcto más la comprobación desde la red de Pablo con comprobar-desde-mi-red.sh. Configuración del host y emergencias las decide Pablo.',
    startAndEnd:
      'Empieza con el push a dev y termina cuando el despliegue llega a finished en la cola de Coolify, las migraciones están aplicadas, /api/v1/health devuelve en su cuerpo el nombre del servicio, estado ok y el commit empujado y la URL abre desde la red de Pablo; en test, cuando origin/test avanza al sha verificado.',
    whenItFails:
      'Un build que muere no retira los contenedores viejos: el servicio sigue sano con código antiguo. Un 137 a los pocos segundos es el enfriamiento de 10 minutos del guardián del H310: se espera, nunca se matan builds. Una migración que falla deja la API sin arrancar. Coolify no espera al CI, y cada despliegue deja unos 12 s sin API.',
    healthIndicator:
      'Despliegues en finished frente a failed en application_deployment_queues, commit servido igual al empujado en /health, ninguna muerte del guardián en los últimos 12 minutos y comprobar-desde-mi-red.sh sin ROJO.',
  },
  success: 'El commit empujado es el que sirve cada bloque, con sus migraciones aplicadas, y se abre desde la red de Pablo.',
  failure: 'El despliegue falla o se queda con el contenedor viejo, la migración tumba la API, o la URL no abre desde la red de Pablo.',
  sources: [
    '.github/workflows/deploy-dev.yml',
    '.github/workflows/ci.yml',
    'docker-compose.coolify.yml',
    'scripts/post-deploy-smoke.mjs',
    'src/modules/health/health.controller.ts',
    'src/modules/internal-portal/application/portal-reports.service.ts',
    '/Users/pablo/Documents/GitHub/atlas/CLAUDE.md §1, §3 y §4',
    '/Users/pablo/Documents/GitHub/atlas/_herramientas/comprobar-desde-mi-red.sh',
    'memoria atlas-autodeploy-actions-coolify',
    'memoria atlas-despliegue-sin-puerta-ni-suelo',
    'memoria atlas-migraciones-al-vps',
    'memoria atlas-caida-en-cada-despliegue',
    'memoria atlas-test-contabo-coolify',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-38)',
  ],
  stages: [
    {
      code: 'deploy_push',
      name: 'Push a dev',
      description:
        'Se commitea con rutas y se empuja a dev; antes se mira que la cola de Coolify esté vacía y que el guardián no haya matado builds en 12 minutos.',
      module: 'deploy',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      steps: [
        {
          code: 'deploy.push_dev',
          name: 'Empujar a dev',
          description: 'La cuenta es admin: el push salta la protección de rama y Coolify arranca sin esperar a Actions.',
          kind: 'manual',
          reason: 'Es un git push desde el árbol de trabajo; no hay puerta: el CI es informe posterior, no compuerta.',
        },
        {
          code: 'deploy.ci_report',
          name: 'CI como informe',
          description: 'ci.yml sólo corre sobre dev porque cada push actualiza el PR #24 (dev → main); cerrarlo dejaría dev sin chequeos.',
          kind: 'external',
          reason: 'Corre en GitHub Actions por el evento pull_request del PR #24, en paralelo al despliegue y sin bloquearlo.',
          optional: true,
        },
      ],
    },
    {
      code: 'deploy_coolify',
      name: 'Despliegue en Coolify',
      description:
        'deploy-dev.yml une el runner a la tailnet, pide el despliegue a la API de Coolify y consulta el estado cada 10 s hasta finished, failed o cancelled; Coolify serializa los builds por servidor.',
      module: 'deploy',
      actor: 'system',
      client: 'BLOCK',
      resultingStates: ['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'],
      steps: [
        {
          code: 'deploy.coolify_deploy_and_wait',
          name: 'Pedir el despliegue y esperar',
          description: 'Falla si el estado terminal no es finished; ante la deduplicación cae a deployments/applications/<uuid>?take=1.',
          kind: 'external',
          reason: 'Llamada del workflow de Actions a la API de Coolify (100.101.207.88:8000) por Tailscale, fuera de los bloques de Atlas.',
          resultingStates: ['finished', 'failed'],
        },
        {
          code: 'deploy.guardian_cooldown',
          name: 'Respetar el enfriamiento del guardián',
          description: 'Un 137 en el git clone es el enfriamiento de 600 s de h310-guardian; se mira h310-emergencia estado y se espera.',
          kind: 'manual',
          reason:
            'Decisión humana sobre el host: nunca matar-builds ni tocar /run/h310-guardian/enfriamiento; la emergencia la decide Pablo.',
          optional: true,
        },
      ],
    },
    {
      code: 'deploy_migrate',
      name: 'Migraciones al desplegar',
      description:
        'El job de un solo disparo migrate corre migrate.js up y seed pull --if-empty después de que Coolify retiró los contenedores viejos.',
      module: 'deploy',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'deploy.migrate_job',
          name: 'Aplicar migraciones',
          description: 'Idempotente; una migración que escribe datos se prueba antes contra una copia de la base desplegada.',
          kind: 'external',
          reason: 'Es el servicio migrate del compose de Coolify, no una llamada: si falla, la API no arranca y es servicio caído.',
        },
      ],
    },
    {
      code: 'deploy_smoke',
      name: 'Smoke del servicio publicado',
      description:
        'post-deploy-smoke.mjs espera liveness y readiness y exige service atlas-backend, status ok y el commit empujado en /health.',
      module: 'health',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'deploy.liveness',
          name: 'Liveness',
          description: 'Debe reportar alive; hasta 12 intentos cada 5 s.',
          method: 'GET',
          path: '/health/liveness',
          auth: false,
        },
        {
          code: 'deploy.readiness',
          name: 'Readiness',
          description: 'Debe reportar ready.',
          method: 'GET',
          path: '/health/readiness',
          auth: false,
        },
        {
          code: 'deploy.health_body',
          name: 'Cuerpo de /health',
          description:
            '«Desplegado» se comprueba por el cuerpo: service atlas-backend, versión conocida y commit igual al empujado, nunca sólo por el código HTTP.',
          method: 'GET',
          path: '/health',
          auth: false,
          output: { service: 'atlas-backend', status: 'ok', commit: 'sha' },
        },
        {
          code: 'deploy.engine_health',
          name: 'Salud del Motor',
          description: 'El Motor despliega por su propio deploy-dev.yml.',
          system: 'DECISION_ENGINE',
          method: 'GET',
          path: '/health',
          auth: false,
          optional: true,
        },
        {
          code: 'deploy.erp_health',
          name: 'Salud del ERP',
          description: 'El ERP despliega por su propio deploy-dev.yml.',
          system: 'ERP_BACKEND',
          method: 'GET',
          path: '/health',
          auth: false,
          optional: true,
        },
        {
          code: 'deploy.dashboards_health',
          name: 'Salud de Tableros',
          description: 'Tableros despliega por su propio workflow.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/health',
          auth: false,
          optional: true,
        },
      ],
    },
    {
      code: 'deploy_release_readiness',
      name: 'Preparación de salida',
      description: 'Lista de comprobación del portal: catálogos poblados, suites QA, calidad de datos y corridas de jobs.',
      module: 'internal_portal',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/release-readiness',
      optional: true,
      roles: PORTAL,
      steps: [
        {
          code: 'deploy.release_readiness',
          name: 'Leer la preparación de salida',
          description: 'Cada control en ok, warning o blocked.',
          method: 'GET',
          path: '/internal/release-readiness',
          roles: PORTAL,
        },
      ],
    },
    {
      code: 'deploy_promote_test',
      name: 'Promoción a test (Contabo)',
      description:
        'Se adelanta la rama test desde la referencia REMOTA tras comprobar que el avance es limpio; el Coolify de Contabo (161.97.85.216) despliega las ramas test.',
      module: 'deploy',
      actor: 'system',
      client: 'BLOCK',
      optional: true,
      steps: [
        {
          code: 'deploy.push_test',
          name: 'git push origin origin/dev:test',
          description:
            'Antes: merge-base --is-ancestor origin/test origin/dev y rev-list origin/dev..origin/test a 0; después, contrastar el sha que imprime git con el verificado.',
          kind: 'manual',
          reason: 'Es un push entre ramas desde la referencia remota, nunca dev:test ni --force; lo hace una persona o sesión.',
        },
      ],
    },
    {
      code: 'deploy_network_check',
      name: 'Comprobación desde la red de Pablo',
      description: 'comprobar-desde-mi-red.sh en el Mac de Pablo: un 403 de FortiGuard, un 502/504 o un cuerpo sin su firma es ROJO.',
      module: 'deploy',
      actor: 'system',
      client: 'BLOCK',
      terminal: true,
      steps: [
        {
          code: 'deploy.check_from_pablo_network',
          name: 'Comprobar las URL desde la red de Pablo',
          description: 'DEV por Tailscale y TEST por IP en bruto; ninguna URL se publica sólo bajo *.sslip.io.',
          kind: 'manual',
          reason: 'Se ejecuta en el Mac de Pablo porque su filtro web bloquea *.sslip.io; desde el VPS todo daba 200.',
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'El inventario pone de dueño PLATFORM_ADMIN, que no es un rol interno; se usa SYSTEMS_ADMIN.',
      'Coolify despliega sin esperar al CI; la ventana sin API bajó de 77 s a 12 s pero existe.',
      'DEC-11 (promoción por digest) abierta.',
      'El estado vive en coolify-db (application_deployment_queues), fuera de AtlasBackend: no hay instanceEntity.',
      'La promoción a test y la comprobación desde la red de Pablo no tienen pantalla ni job.',
    ],
  },
};
