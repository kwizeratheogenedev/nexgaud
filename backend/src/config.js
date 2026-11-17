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

  // Shared secret in the USSD and SMS callback URLs (?key=...). Without it the gateway routes are off in production.
  GATEWAY_SECRET: z.string().min(16).optional(),
  // The USSD code people dial, shown in SMS replies and on the check page (for example *123#).
  USSD_CODE: z.string().max(20).optional(),
  // Where the public check page lives, used in SMS replies.
  PUBLIC_CHECK_URL: z.string().url().optional(),
  // The dashboard's public address: QR tags link to <PUBLIC_APP_URL>/t/<code>, and SMS to finders link there.
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  // The API's public address, for payment callbacks (MTN and Airtel call it when a payment finishes).
  PUBLIC_API_URL: z.string().url().optional(),

  // ---- Plans and payments. Prices in Rwandan francs: placeholders until the team decides. ----
  PRICE_FAMILY_MONTHLY_RWF: z.coerce.number().int().min(0).default(2000),
  PRICE_LAPTOP_SEAT_MONTHLY_RWF: z.coerce.number().int().min(0).default(1000),
  // Organisations get this many laptops without paying.
  ORG_FREE_LAPTOPS: z.coerce.number().int().min(0).default(5),
  // What the servers cost per month, for the Phase 5 gate (paying customers cover server costs).
  SERVER_COST_MONTHLY_RWF: z.coerce.number().int().min(0).default(0),
  // Shared secret in the payment callback URLs (?key=...).
  PAYMENT_CALLBACK_SECRET: z.string().min(16).optional(),
  // MTN MoMo Collection API (momodeveloper.mtn.com). Sandbox by default.
  MOMO_BASE_URL: z.string().url().default('https://sandbox.momodeveloper.mtn.com'),
  MOMO_TARGET_ENV: z.string().default('sandbox'), // mtnrwanda in production
  MOMO_CURRENCY: z.string().length(3).default('EUR'), // the sandbox only accepts EUR; RWF in production
  MOMO_SUBSCRIPTION_KEY: z.string().optional(),
  MOMO_API_USER: z.string().optional(),
  MOMO_API_KEY: z.string().optional(),
  // Airtel Money Collection API (developers.airtel.africa). UAT (test) by default.
  AIRTEL_BASE_URL: z.string().url().default('https://openapiuat.airtel.africa'),
  AIRTEL_CLIENT_ID: z.string().optional(),
  AIRTEL_CLIENT_SECRET: z.string().optional(),
  AIRTEL_COUNTRY: z.string().length(2).default('RW'),
  AIRTEL_CURRENCY: z.string().length(3).default('RWF'),

  // Bearer token for GET /metrics (Prometheus format). Without it, /metrics is off in production.
  METRICS_TOKEN: z.string().min(16).optional(),
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
  gatewaySecret: env.GATEWAY_SECRET ?? (isProd ? null : 'dev-gateway-secret-change-me'),
  paymentCallbackSecret: env.PAYMENT_CALLBACK_SECRET ?? (isProd ? null : 'dev-payment-secret-change-me'),
  metricsToken: env.METRICS_TOKEN ?? null,
  // Set by scripts/demo.js: show sign-in codes on the page, since the demo sends no real SMS.
  demoShowCodes: process.env.NEXGUARD_DEMO === '1' && !isProd && env.SMS_PROVIDER === 'console',
};
