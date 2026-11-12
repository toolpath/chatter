import { Notice } from '../../components/ui/Notice';

/** What a Settings tab shows before its report is there: why it did not load, or that it still loads */
export function ReportPending({ loadError }: { loadError: string | null }) {
  if (loadError) return <Notice tone="error" title={loadError} />;
  return <p className="m-0 text-zinc-300">Loading…</p>;
}
