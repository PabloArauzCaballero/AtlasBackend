import { z } from 'zod';

export const registerCustomerSchema = z
  .object({
    phone: z.string().trim().min(6).max(40).optional(),
    email: z.string().trim().email().max(180).optional(),
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferredLanguage: z.string().trim().min(2).max(10).default('es'),
    marketingOptIn: z.boolean().default(false),
    sourceType: z.string().trim().min(1).max(40).default('mobile_app'),
  })
  .refine((value) => value.phone !== undefined || value.email !== undefined, {
    message: 'Debe existir al menos teléfono o email para registrar un cliente.',
    path: ['phone'],
  });

export const customerIdParamsSchema = z.object({
  customerId: z.string().regex(/^[1-9][0-9]*$/),
});

export type RegisterCustomerDto = z.infer<typeof registerCustomerSchema>;
export type CustomerIdParamsDto = z.infer<typeof customerIdParamsSchema>;
