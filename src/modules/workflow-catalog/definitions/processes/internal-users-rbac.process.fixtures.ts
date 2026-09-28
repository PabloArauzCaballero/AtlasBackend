/**
 * @file Proceso declarado en código: Usuarios internos, roles, permisos, acceso con PIN y sincronización del catálogo RBAC.
 * @business Quién puede operar Atlas y con qué privilegios tiene que ser una decisión trazable: alta con motivo, roles privilegiados sólo por un superadministrador, segundo factor siempre y un catálogo de permisos que llegue de verdad a la base.
 * @system fixture P-34 que `syncWorkflowCatalog` vuelca a `workflow_*`; `internal-auth.controller.ts`, `internal-users.controller.ts`, `internal-access-catalog.controller.ts` y las migraciones `sync-internal-rbac-catalog-N`.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

/** Roles internos que tienen `internal.users.manage` + `internal.roles.manage` (ROLE_PERMISSION_CODES). */
const IDENTITY_ADMINS = ['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'INTERNAL_IDENTITY_ADMIN'];

export const INTERNAL_USERS_RBAC: WorkflowDefinitionFixture = {
  processId: 'P-34',
  code: 'internal_users_rbac',
  version: 'v1',
  name: 'Usuarios internos, roles, permisos, acceso con PIN y sincronización del catálogo RBAC',
  description:
    'El ciclo de vida del personal interno: alta con contraseña y roles, asignación y retiro de roles con la regla de roles privilegiados, suspensión o bloqueo, acceso al portal con contraseña más PIN por correo, y el volcado del catálogo de permisos del código a la base por migración.',
  processType: 'back_office',
  ownerDomain: 'platform',
  ownerRole: 'INTERNAL_IDENTITY_ADMIN',
  priority: 'P2',
  systems: ['ATLAS_BACKEND'],
  narrative: {
    whyExists:
      'Controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios: sin él cualquiera con acceso al portal podría darse roles críticos, y un permiso declarado en el código no serviría de nada porque sin migración no llega a la base y el portal responde 403 a todos.',
    whoStartsAndCloses:
      'Lo inicia un administrador de identidad interna (INTERNAL_IDENTITY_ADMIN, SYSTEMS_ADMIN o SUPER_ADMIN) al dar de alta a una persona con motivo; tocar un rol privilegiado exige SUPER_ADMIN. Lo cierra la propia persona al entrar con contraseña y PIN, o el administrador al suspenderla.',
    startAndEnd:
      'Empieza con el alta (contraseña de al menos 10 caracteres, entre 1 y 8 roles y un motivo) y termina con el usuario activo entrando con PIN; un permiso nuevo empieza en internal-rbac.catalog.*.ts y termina volcado a la base por la migración sync-internal-rbac-catalog-N al desplegar.',
    whenItFails:
      'Un login fallido repetido bloquea la cuenta hasta locked_until (401 ACCOUNT_LOCKED con la hora de vuelta) aunque el usuario figure activo; un administrador la desbloquea antes desde la ficha del usuario, con motivo. Un permiso sin migración responde 403 en todos los entornos (pasó con partner.qr.review). Sin correo real el PIN no llega y nadie entra.',
    healthIndicator:
      'Usuarios activos con al menos un rol, cuentas con locked_until vigente, altas sin primer acceso y permisos del código que faltan en la base; el administrador ve usuarios y roles en «Usuarios» y «Roles» del portal.',
  },
  instanceEntity: {
    system: 'ATLAS_BACKEND',
    schema: 'iam',
    table: 'internal_users',
    idColumn: '_id',
    statusColumn: 'status',
    labelColumn: 'email',
    openStatuses: ['invited', 'locked', 'suspended'],
  },
  success:
    'La persona entra al portal con contraseña y PIN y ve sólo lo que sus roles permiten; el catálogo de permisos del código coincide con la base.',
  failure: 'La persona no puede entrar (bloqueo, PIN que no llega), tiene privilegios de más, o un permiso declarado no existe en la base.',
  sources: [
    'src/modules/internal-users/internal-auth.controller.ts',
    'src/modules/internal-users/internal-users.controller.ts',
    'src/modules/internal-users/internal-access-catalog.controller.ts',
    'src/modules/internal-users/internal-users.schemas.ts',
    'src/modules/internal-users/internal-users.policy.ts',
    'src/modules/internal-users/internal-rbac.permissions.ts',
    'src/database/migrations/20260915140000-sync-internal-rbac-catalog-2.ts',
    'memoria atlas-crear-superadmin-interno',
    'memoria atlas-reactivar-cuenta-interna',
    'CLAUDE.md §2 (permiso nuevo en internal-rbac.* no llega solo a la base)',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-34)',
  ],
  stages: [
    {
      code: 'internal_user_creation',
      name: 'Alta del usuario interno',
      description:
        'El administrador da de alta a la persona con correo, nombre, departamento, contraseña inicial, roles y motivo; asignar un rol privilegiado exige SUPER_ADMIN.',
      module: 'internal_users',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/users/new',
      entry: true,
      roles: IDENTITY_ADMINS,
      resultingStates: ['active', 'invited'],
      steps: [
        {
          code: 'iam.signup',
          name: 'Crear el usuario interno',
          description:
            'Crea usuario, credencial Argon2id y roles en una transacción; must_change_password por defecto. Permisos internal.users.manage + internal.roles.manage.',
          method: 'POST',
          path: '/internal/auth/signup',
          roles: IDENTITY_ADMINS,
          input: {
            email: 'string',
            fullName: 'string',
            department: 'string',
            password: 'string',
            roles: 'InternalRoleCode[]',
            reason: 'string',
          },
          errors: ['403 rol privilegiado sin SUPER_ADMIN', '409 INTERNAL_USER_EMAIL_ALREADY_EXISTS'],
        },
        {
          code: 'iam.bootstrap_first_admin',
          name: 'Alta del primer superadministrador',
          description:
            'Cuando nadie puede entrar se insertan a mano internal_users, auth_credentials e internal_user_roles en una transacción.',
          kind: 'manual',
          reason:
            'No existe guion de bootstrap: la ruta de alta exige una sesión con permiso, así que el primer administrador se crea por SQL.',
          optional: true,
        },
      ],
    },
    {
      code: 'internal_role_assignment',
      name: 'Roles y estado',
      description:
        'El administrador reemplaza los roles de una persona o cambia su estado (active, invited, suspended, locked, disabled); quitar un rol privilegiado exige lo mismo que asignarlo.',
      module: 'internal_users',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/users/[internalUserId]',
      roles: IDENTITY_ADMINS,
      steps: [
        {
          code: 'iam.list_users',
          name: 'Listar usuarios internos',
          description: 'Permiso internal.users.read.',
          method: 'GET',
          path: '/internal/users',
          roles: IDENTITY_ADMINS,
        },
        {
          code: 'iam.user_detail',
          name: 'Ver un usuario interno',
          description: 'Datos, estado, roles y último acceso.',
          method: 'GET',
          path: '/internal/users/:internalUserId',
          roles: IDENTITY_ADMINS,
        },
        {
          code: 'iam.replace_roles',
          name: 'Reemplazar los roles',
          description:
            'Permisos internal.users.manage + internal.roles.manage; SUPER_ADMIN si toca SUPER_ADMIN, SYSTEMS_ADMIN o INTERNAL_IDENTITY_ADMIN.',
          method: 'PATCH',
          path: '/internal/users/:internalUserId/roles',
          roles: IDENTITY_ADMINS,
          errors: ['403 rol privilegiado sin SUPER_ADMIN'],
        },
        {
          code: 'iam.update_user',
          name: 'Editar o suspender',
          description: 'Cambia datos y estado; suspended, locked y disabled cortan el acceso.',
          method: 'PATCH',
          path: '/internal/users/:internalUserId',
          roles: IDENTITY_ADMINS,
          optional: true,
          resultingStates: ['active', 'suspended', 'locked', 'disabled'],
        },
      ],
    },
    {
      code: 'internal_access_catalog',
      name: 'Consulta de roles y permisos',
      description: 'El administrador consulta los 20 roles internos y los permisos que concede cada uno.',
      module: 'internal_users',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/roles',
      optional: true,
      steps: [
        {
          code: 'iam.list_roles',
          name: 'Listar roles',
          description: 'Permiso internal.roles.read.',
          method: 'GET',
          path: '/internal/roles',
          roles: IDENTITY_ADMINS,
        },
        {
          code: 'iam.role_detail',
          name: 'Ver un rol',
          description: 'Permisos del rol.',
          method: 'GET',
          path: '/internal/roles/:roleId',
          roles: IDENTITY_ADMINS,
        },
        {
          code: 'iam.list_permissions',
          name: 'Listar permisos',
          description: 'Permiso internal.permissions.read; se ve en «Permisos».',
          method: 'GET',
          path: '/internal/permissions',
          roles: IDENTITY_ADMINS,
        },
      ],
    },
    {
      code: 'internal_login_with_pin',
      name: 'Acceso con contraseña y PIN',
      description:
        'La persona entra al portal: la contraseña responde 200 con pinChallengeRequired y el PIN llega a su correo; todo actor interno exige segundo factor, sin excepción de rol.',
      module: 'internal_users',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/login',
      terminal: true,
      steps: [
        {
          code: 'iam.login',
          name: 'Entrar con contraseña',
          description: 'Pública; exige x-tenant-id. Responde con el reto de PIN.',
          method: 'POST',
          path: '/internal/auth/login',
          auth: false,
          output: { pinChallengeRequired: 'boolean' },
          errors: ['401 credenciales inválidas', '401 ACCOUNT_LOCKED (con lockedUntil y retryAfterSeconds)'],
        },
        {
          code: 'iam.login_pin',
          name: 'Confirmar el PIN',
          description: 'Sólo vale el PIN del intento en curso; deja la sesión en cookies HttpOnly.',
          method: 'POST',
          path: '/internal/auth/login/pin',
          auth: false,
          resultingStates: ['active'],
        },
        {
          code: 'iam.me',
          name: 'Leer el perfil de acceso',
          description: 'Roles y permisos efectivos de la sesión (auth.internal.me.read); el menú se pinta con ellos.',
          method: 'GET',
          path: '/internal/auth/me',
        },
        {
          code: 'iam.refresh',
          name: 'Refrescar la sesión',
          description: 'Renueva el token; sólo se cierra la sesión si el servidor rechaza el refresco.',
          method: 'POST',
          path: '/internal/auth/refresh',
          auth: false,
          repeatable: true,
        },
        {
          code: 'iam.logout',
          name: 'Cerrar sesión',
          description: 'Invalida la sesión actual.',
          method: 'POST',
          path: '/internal/auth/logout',
          auth: false,
          optional: true,
        },
      ],
    },
    {
      code: 'internal_account_unlock',
      name: 'Desbloqueo de una cuenta',
      description:
        'Un «no me deja entrar» casi siempre es locked_until en iam.auth_credentials; el bloqueo expira solo, y un administrador lo levanta antes desde la ficha del usuario.',
      module: 'internal_users',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      screen: '/internal/settings/users/[internalUserId]',
      optional: true,
      roles: IDENTITY_ADMINS,
      steps: [
        {
          code: 'iam.unlock',
          name: 'Desbloquear la cuenta',
          description:
            'Permiso internal.users.manage y motivo obligatorio: limpia locked_until y el contador de intentos, auditado como internal_users.unlock. No cambia el estado ni revoca sesiones.',
          method: 'POST',
          path: '/internal/users/:internalUserId/unlock',
          roles: IDENTITY_ADMINS,
          errors: ['404 INTERNAL_USER_NOT_FOUND', '409 INTERNAL_USER_NOT_LOCKED'],
        },
      ],
    },
    {
      code: 'rbac_catalog_sync',
      name: 'Sincronización del catálogo RBAC',
      description:
        'Un permiso o rol nuevo en internal-rbac.catalog.*.ts sólo llega a la base con una migración nueva que repita el volcado (syncInternalRbacCatalog), aplicada por el job migrate al desplegar.',
      module: 'internal_users',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'rbac.sync_migration',
          name: 'Migración sync-internal-rbac-catalog-N',
          description: 'Vuelca permisos y su asignación a roles; la vigente es la de número más alto en src/database/migrations.',
          kind: 'manual',
          reason:
            'Es una migración revisada en PR que corre en el despliegue (P-38), no una llamada: el volcado 20260821040000 ya corrió y no se repite solo.',
        },
      ],
    },
  ],
  metadata: {
    gaps: [
      'El inventario pone de dueño SUPER_ADMIN; el rol cuyo cometido es éste es INTERNAL_IDENTITY_ADMIN (SUPER_ADMIN queda para roles privilegiados).',
      'El inventario dice estados active/locked/disabled; el esquema admite active/invited/suspended/locked/disabled, y el bloqueo real vive en auth_credentials.locked_until.',
      'Los roles no los inserta ninguna migración: vienen de la base de semillas.',
      'La memoria habla de POST /internal/users; la ruta real de alta es POST /internal/auth/signup.',
    ],
  },
};
