export default function Loading() {
  return (
    <div className="space-y-3 py-4" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
      <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
      <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
    </div>
  );
}
