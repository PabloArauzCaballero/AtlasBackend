import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('atlas'),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_SCHEMA: z.string().min(1).default('public'),
  DB_SSL: z.coerce.boolean().default(false),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);
