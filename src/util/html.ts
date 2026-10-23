const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Für die wenigen Stellen, an denen Leaflet HTML-Strings erwartet. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => MAP[c]);
}

export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export { fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtShort, plural } from '../domain/format';
