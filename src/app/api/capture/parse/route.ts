import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { features } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { draftFromText } from '@/lib/capture/pipeline';
import { getSettings } from '@/lib/services/settings';

const body = z.object({ text: z.string().trim().min(1).max(1000), useAI: z.boolean().default(false) });

/** Text → editable draft. Never saves anything. */
export const POST = route(async (req, { user }) => {
  const { text, useAI } = body.parse(await readJson(req));
  const ai = useAI && features().aiExtract;
  if (ai && !rateLimit(`ai:${user.id}`, 60, 60 * 60_000).ok) throw new HttpError(429, 'سقف استفاده از تحلیل هوشمند در این ساعت پر شده است', 'rate_limited');
  const s = await getSettings(user.id);
  return { draft: await draftFromText(text, { tz: s.timezone, useAI: ai }) };
});
