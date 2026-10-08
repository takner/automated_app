import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">این صفحه پیدا نشد</h1>
      <Link href="/" className="btn-primary">بازگشت به امروز</Link>
    </main>
  );
}
