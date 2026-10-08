import { route } from '@/lib/api';
import { exportUserData } from '@/lib/services/export';

export const GET = route(async (_req, { user }) => {
  const data = await exportUserData(user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="hamrooz-export-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
});
