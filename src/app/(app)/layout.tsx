import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { env, features } from '@/lib/env';
import { todayIn } from '@/lib/dates';
import { getSettings } from '@/lib/services/settings';
import { Nav } from '@/components/nav';
import { QuickAdd } from '@/components/quick-add';
import { ToastProvider } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const s = await getSettings(user.id);
  const f = features();
  return (
    <ToastProvider>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 pb-32 pt-4 md:px-6 md:pb-12">{children}</main>
      <Suspense>
        <QuickAdd
          today={todayIn(s.timezone)}
          features={{ stt: f.stt, aiExtract: f.aiExtract, voiceConsent: !!s.voiceConsentAt, maxSeconds: env().VOICE_MAX_SECONDS }}
        />
      </Suspense>
    </ToastProvider>
  );
}
