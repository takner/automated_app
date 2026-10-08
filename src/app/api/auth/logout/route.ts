import { destroySession } from '@/lib/auth';
import { publicRoute } from '@/lib/api';

export const POST = publicRoute(async () => {
  await destroySession();
  return { ok: true };
});
