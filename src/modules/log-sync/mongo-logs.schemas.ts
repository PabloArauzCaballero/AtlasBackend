import { z } from 'zod';

export const mongoLogsQuerySchema = z.object({
  type: z.enum(['startup', 'append', 'rotation']).optional(),
  service: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type MongoLogsQueryDto = z.infer<typeof mongoLogsQuerySchema>;
