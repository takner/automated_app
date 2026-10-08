import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { features } from '@/lib/env';
import { LoginForm } from '@/components/login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <img src="/icons/icon-192.png" alt="" width={64} height={64} className="mx-auto mb-3 rounded-2xl" />
        <h1 className="text-2xl font-bold">هم‌روز</h1>
        <p className="mt-1 text-sm text-muted">کارها، یادآوری‌ها و برنامهٔ روزانهٔ شما</p>
      </div>
      <LoginForm googleEnabled={features().googleLogin} initialError={error?.slice(0, 200) ?? null} />
      <p className="text-center text-xs text-muted">این برنامه شخصی است و ثبت‌نام عمومی ندارد.</p>
    </main>
  );
}
