import 'dotenv/config';
import { z } from 'zod';

// Every setting the API reads lives here, validated once at startup.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/nexguard'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Signs access and refresh tokens. Must be long and random in production.
  JWT_SECRET: z.string().optional(),
  // Keys the HMAC used to store sign-in codes and device tokens.
  HASH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // console = print codes to the log (development); africastalking = real SMS.
  SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  // Country code used when someone types a local number such as 0788123456.
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default('250'),

  // Base64 of the Firebase service-account JSON. Without it, phones pick up commands when they next upload.
  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const isProd = env.NODE_ENV === 'production';

function secret(name) {
  const value = env[name];
  if (value && value.length >= 32) return value;
  if (isProd) {
    console.error(`${name} must be set to at least 32 random characters in production.`);
    process.exit(1);
  }
  return `dev-only-${name}-not-for-production-use-000000`;
}

if (isProd && env.SMS_PROVIDER === 'console') {
  console.error('SMS_PROVIDER=console is not allowed in production.');
  process.exit(1);
}

export const config = {
  ...env,
  jwtSecret: secret('JWT_SECRET'),
  hashSecret: secret('HASH_SECRET'),
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd,
  isTest: env.NODE_ENV === 'test',
};
