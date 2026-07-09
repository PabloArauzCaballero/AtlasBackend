import { z } from 'zod';

export const internalRoleParamsSchema = z.object({
  roleId: z.string().regex(/^[1-9][0-9]*$/),
});

export type InternalRoleParamsDto = z.infer<typeof internalRoleParamsSchema>;
