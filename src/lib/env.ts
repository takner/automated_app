// Server-only configuration. Optional integrations stay disabled (and say so in the UI) when
// their variables are missing; nothing falls back to fake behaviour.
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_RELEASE: z.string().default('dev'),
  APP_ENCRYPTION_KEY: z.string().optional(), // base64, 32 bytes
  OWNER_EMAIL: z.string().email().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  STT_MODEL: z.string().default('gpt-4o-transcribe'),
  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACT_MODEL: z.string().default('claude-opus-5-5'),
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
    cached = schema.parse(clean);
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';

export function features() {
  const e = env();
  return {
    push: !!(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
    google: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.APP_ENCRYPTION_KEY),
    googleLogin: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.OWNER_EMAIL),
    stt: !!e.OPENAI_API_KEY,
    aiExtract: !!e.ANTHROPIC_API_KEY,
  };
}
