import type { ReactNode } from 'react';

/** A small card with one fact: a label, and the value under it */
export function InfoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      <span className="font-semibold">{children}</span>
    </div>
  );
}
