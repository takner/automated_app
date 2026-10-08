'use client';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-bold">مشکلی پیش آمد</h1>
      <p className="text-sm text-muted">اگر اینترنت قطع است، بعد از وصل شدن دوباره امتحان کنید.</p>
      <button className="btn-primary" onClick={reset}>تلاش دوباره</button>
    </div>
  );
}
