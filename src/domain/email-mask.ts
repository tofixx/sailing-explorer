/**
 * E-Mail-Adresse maskiert anzeigen (Konzept 10.2, Entscheidung 28.10.2026): erster Buchstabe vor dem „@“, erster
 * Buchstabe der Domain und die Endung – „anna@example.org“ → „a…@e….org“. Reicht zum Wiedererkennen, verrät aber
 * weder Namen noch eigene Domains. Ohne gültige Form: nur „…“.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (at < 1 || dot < 1 || dot === domain.length - 1) return '…';
  return `${local[0]}…@${domain[0]}…${domain.slice(dot)}`;
}
