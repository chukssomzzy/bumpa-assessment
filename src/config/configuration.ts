import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/**
 * Configuration is parsed and validated at boot. A missing or malformed value
 * prevents startup rather than surfacing later as an undefined at the first
 * payment or a signature check against `undefined`.
 */

const parse = <T>(schema: z.ZodType<T>, input: unknown, name: string): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid ${name} configuration:\n${detail}`);
  }
  return result.data;
};

const port = z.coerce.number().int().positive();

export const appConfig = registerAs('app', () =>
  parse(
    z.object({
      port: port.default(3000),
      nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
    }),
    { port: process.env.PORT, nodeEnv: process.env.NODE_ENV },
    'app',
  ),
);

export const databaseConfig = registerAs('database', () =>
  parse(z.object({ url: z.string().min(1) }), { url: process.env.DATABASE_URL }, 'database'),
);

export const redisConfig = registerAs('redis', () =>
  parse(z.object({ url: z.string().min(1) }), { url: process.env.REDIS_URL }, 'redis'),
);

export const webhookConfig = registerAs('webhook', () =>
  parse(
    z.object({
      secret: z.string().min(1),
      toleranceSeconds: z.coerce.number().int().positive().default(300),
    }),
    {
      secret: process.env.WEBHOOK_SECRET,
      toleranceSeconds: process.env.WEBHOOK_TOLERANCE_SECONDS,
    },
    'webhook',
  ),
);

export const paymentsConfig = registerAs('payments', () =>
  parse(
    z
      .object({
        provider: z.enum(['fake', 'paystack']).default('fake'),
        paystackSecretKey: z.string().optional(),
        paystackBaseUrl: z.string().default('https://api.paystack.co'),
        cashbackAmountKobo: z.coerce.number().int().positive().default(30_000),
        maxAttempts: z.coerce.number().int().positive().default(5),
        staleAfterSeconds: z.coerce.number().int().positive().default(300),
      })
      // A paystack provider without a key would fail at the first transfer, inside
      // a retrying job. Fail at boot instead.
      .refine((c) => c.provider !== 'paystack' || !!c.paystackSecretKey, {
        message: 'PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack',
        path: ['paystackSecretKey'],
      }),
    {
      provider: process.env.PAYMENT_PROVIDER,
      paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
      paystackBaseUrl: process.env.PAYSTACK_BASE_URL,
      cashbackAmountKobo: process.env.CASHBACK_AMOUNT_KOBO,
      maxAttempts: process.env.PAYOUT_MAX_ATTEMPTS,
      staleAfterSeconds: process.env.PAYOUT_STALE_AFTER_SECONDS,
    },
    'payments',
  ),
);

export const allConfig = [appConfig, databaseConfig, redisConfig, webhookConfig, paymentsConfig];
