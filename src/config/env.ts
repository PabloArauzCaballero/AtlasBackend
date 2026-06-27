import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('atlas'),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_SCHEMA: z.string().min(1).default('public'),
  DB_SSL: z.coerce.boolean().default(false),
  JWT_ACCESS_TOKEN_SECRET: z.string().min(32).default('dev-only-atlas-access-token-secret-change-me'),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().default('1h'),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = envSchema.parse(process.env);

export function getAllowedCorsOrigins(): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
