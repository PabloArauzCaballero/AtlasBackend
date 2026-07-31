/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { z } from 'zod';
import { birthDateSchema } from './customer-onboarding-profile.schemas.js';

const ALLOWED_PERMISSION_CODES = ['location', 'camera', 'contacts', 'notifications', 'storage'] as const;

export const startOnboardingSchema = z.object({
  customer: z
    .object({
      phone: z.string().trim().min(6).max(40).optional(),
      email: z.string().trim().email().max(180).optional(),
      firstName: z.string().trim().min(1).max(120).optional(),
      lastName: z.string().trim().min(1).max(120).optional(),
      // Validación de edad (antes inexistente): nada impedía registrar a un menor de edad.
      birthDate: birthDateSchema.optional(),
    })
    .refine((v) => v.phone !== undefined || v.email !== undefined, {
      message: 'Se requiere al menos teléfono o email para iniciar onboarding.',
      path: ['phone'],
    }),

  // La contraseña es OBLIGATORIA. Antes era opcional, y un cliente registrado sin ella quedaba sin
  // ninguna forma de entrar jamás: no existe endpoint para fijarla después y
  // `POST /auth/password-reset/request` retorna sin hacer nada si el actor no tiene credenciales
  // (`auth-password-reset.service.ts`). Es decir, la cuenta nacía muerta y en silencio.
  password: z.string().trim().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(128),

  consents: z
    .array(
      z.object({
        consentDocumentId: z.string().regex(/^[1-9][0-9]*$/),
        purposeCode: z.string().trim().min(1).max(80),
        granted: z.boolean(),
        acceptedAt: z.string().datetime().optional(),
      }),
    )
    .min(1, 'Se requiere al menos un consentimiento.'),

  device: z.object({
    deviceFingerprintHash: z.string().trim().min(32).max(128),
    fingerprintVersion: z.string().trim().min(1).max(40).default('v1'),
    channel: z.enum(['mobile_app', 'web_app']),
    userAgent: z.string().trim().max(500).optional(),
    snapshot: z
      .object({
        brand: z.string().trim().max(80).optional(),
        model: z.string().trim().max(120).optional(),
        osFamily: z.string().trim().max(40).optional(),
        osVersion: z.string().trim().max(60).optional(),
        appVersion: z.string().trim().max(60).optional(),
        isRooted: z.boolean().optional(),
        isEmulator: z.boolean().optional(),
        vpnDetected: z.boolean().optional(),
        timezone: z.string().trim().max(60).optional(),
        locale: z.string().trim().max(20).optional(),
      })
      .optional(),
  }),

  permissions: z
    .array(
      z.object({
        permissionCode: z.enum(ALLOWED_PERMISSION_CODES),
        granted: z.boolean(),
        decidedAt: z.string().datetime().optional(),
      }),
    )
    .optional(),

  onboarding: z
    .object({
      sourceType: z.string().trim().min(1).max(40).default('mobile_app'),
      startedStepCode: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
});

export type StartOnboardingDto = z.infer<typeof startOnboardingSchema>;

export const onboardingCustomerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export const contactVerificationRequestSchema = z.object({
  contactType: z.enum(['phone', 'email']),
  verificationChannel: z.enum(['sms', 'email', 'whatsapp']),
  sessionId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});

export const contactVerificationSubmitSchema = z.object({
  contactType: z.enum(['phone', 'email']),
  verificationChannel: z.enum(['sms', 'email', 'whatsapp']),
  verificationCode: z.string().trim().min(4).max(12),
  sessionId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});

const identityEvidenceSchema = z.object({
  evidenceType: z.enum(['identity_front', 'identity_back', 'selfie', 'proof_of_address', 'other']),
  storageKey: z
    .string()
    .trim()
    .min(8)
    .max(500)
    .refine((value) => !value.startsWith('data:'), {
      message: 'No se permite enviar evidencia en base64 dentro del body.',
    }),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  sha256Hash: z.string().trim().min(32).max(128),
  fileSizeBytes: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});

export const identityPackageSchema = z.object({
  identity: z.object({
    documentType: z.enum(['ci', 'passport', 'foreign_id']),
    documentNumberHash: z.string().trim().min(32).max(128),
    documentLast4: z.string().trim().min(2).max(4),
    countryCode: z.string().trim().length(3).default('BOL'),
    issuedIn: z.string().trim().max(60).optional(),
    issuedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    // La vigencia pasa a ser obligatoria y se valida contra la fecha actual: antes se aceptaba
    // —y se daba por buena como evidencia KYC— un documento vencido, o sin fecha de vencimiento.
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => new Date(`${value}T23:59:59.999Z`).getTime() > Date.now(), {
        message: 'El documento de identidad está vencido.',
      }),
  }),
  evidence: z.array(identityEvidenceSchema).min(1).max(5),
  provider: z
    .object({
      providerCode: z.string().trim().min(1).max(80),
      requestPayloadHash: z.string().trim().min(32).max(128).optional(),
    })
    .optional(),
  sessionId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});

export const addressPackageSchema = z.object({
  address: z.object({
    countryCode: z.string().trim().length(3).default('BOL'),
    department: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(120),
    zone: z.string().trim().max(120).optional(),
    addressLineEncrypted: z.string().trim().max(500).optional(),
    referenceEncrypted: z.string().trim().max(500).optional(),
  }),
  gpsObservation: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyMeters: z.number().positive().max(10000).optional(),
      capturedAt: z.string().datetime().optional(),
    })
    .optional(),
  sessionId: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
});

export type OnboardingCustomerIdParamsDto = z.infer<typeof onboardingCustomerIdParamsSchema>;
export type ContactVerificationRequestDto = z.infer<typeof contactVerificationRequestSchema>;
export type ContactVerificationSubmitDto = z.infer<typeof contactVerificationSubmitSchema>;
export type IdentityPackageDto = z.infer<typeof identityPackageSchema>;
export type AddressPackageDto = z.infer<typeof addressPackageSchema>;
