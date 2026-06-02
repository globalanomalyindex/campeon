import type { Ms, Result, Session } from '../types';

export interface ExportBundle {
  version: string;
  exportedAt: Ms;
  sessions: Session[];
  results: Record<string, Result>;
}

export function buildExportBundle(
  sessions: readonly Session[],
  results: Readonly<Record<string, Result>>,
  now: Ms,
): ExportBundle {
  return { version: '1', exportedAt: now, sessions: [...sessions], results: { ...results } };
}

export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Browser-only: trigger a file download of `json`. Untested DOM glue. */
export function triggerDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
