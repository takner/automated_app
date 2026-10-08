export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">اتصال اینترنت برقرار نیست</h1>
      <p className="text-muted">
        هم‌روز برای دیدن و ثبت کارها به اینترنت نیاز دارد. ثبت آفلاین در این نسخه پشتیبانی نمی‌شود؛ بعد از وصل شدن، صفحه را دوباره باز کنید.
      </p>
      <p className="text-sm text-muted">یادآوری‌هایی که قبلاً زمان‌بندی شده‌اند از سرور ارسال می‌شوند، ولی برای دریافتشان گوشی باید به اینترنت وصل باشد.</p>
      <a href="/" className="btn-primary">تلاش دوباره</a>
    </main>
  );
}
