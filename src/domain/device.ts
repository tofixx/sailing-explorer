// Gerätename aus dem User-Agent – rein, ohne DOM. Für die Passkey-Liste (Konzept 14.7), damit man Einträge wiedererkennt.

export function deviceName(ua: string, touchPoints = 0): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Passkey';
}
