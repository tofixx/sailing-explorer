import type { Env } from './env';
import { HttpError } from './http';
import { VOYAGE_ROLE_SHORT, type VoyageRole } from '../src/domain/crew-roles';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function magicLinkMail(env: Env, to: string, link: string, code: string): Mail {
  const app = env.APP_NAME;
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `Hallo,\n\nmit diesem Link meldest du dich bei ${app} an:\n\n${link}\n\nOder gib diesen Code ein (z. B. in der App auf dem Home-Bildschirm oder auf einem anderen Gerät): ${spaced}\n\nLink und Code sind 15 Minuten gültig und funktionieren nur einmal. Wenn du das nicht angefordert hast, ignoriere diese Mail einfach.\n`;
  // Link stammt aus unserer eigenen Origin + base64url-Token, enthält also keine HTML-Sonderzeichen.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>mit diesem Link meldest du dich bei <b>${app}</b> an:</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Anmelden</a></p>
<p>Oder gib diesen Code ein – z. B. in der App auf dem Home-Bildschirm oder auf einem anderen Gerät:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,monospace">${spaced}</p>
<p style="color:#5b6b7b;font-size:13px">Link und Code sind 15 Minuten gültig und funktionieren nur einmal. Wenn du das nicht angefordert hast, ignoriere diese Mail einfach.</p>
</body></html>`;
  // Code bewusst nicht im Betreff (Sperrbildschirm, Mitteilungen) – iOS füllt ihn trotzdem aus der Mail vor.
  return { to, subject: `Dein Anmeldelink für ${app}`, text, html };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Erinnerung: diese Törns werden bald gelöscht – mit Hinweis auf Unterstützen. */
export function expiryWarningMail(env: Env, to: string, origin: string, shares: Array<{ title: string; expiresAt: number }>): Mail {
  const app = env.APP_NAME;
  const date = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const name = (t: string) => t.trim() || 'Ohne Titel';
  const lines = shares.map((s) => `• ${name(s.title)} – gelöscht am ${date(s.expiresAt)}`).join('\n');
  const link = `${origin}/?support=open`;
  const text = `Hallo,\n\nfolgende geteilte Törns bei ${app} werden bald automatisch gelöscht:\n\n${lines}\n\nKostenlose Törns bleiben für ihre Saison gespeichert (bis Ende Januar danach). Mit einer Unterstützung (ab einem Kaffee) nimmst du sie in die nächste Saison mit:\n${link}\n\nWenn du nichts tust, werden sie zum genannten Datum entfernt.\n`;
  // Titel stammen von Nutzern → escapen.
  const items = shares.map((s) => `<li><b>${escapeHtml(name(s.title))}</b> – gelöscht am ${date(s.expiresAt)}</li>`).join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>folgende geteilte Törns bei <b>${app}</b> werden bald automatisch gelöscht:</p><ul>${items}</ul>
<p>Kostenlose Törns bleiben für ihre Saison gespeichert (bis Ende Januar danach). Mit einer Unterstützung (ab einem Kaffee) nimmst du sie in die nächste Saison mit.</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Unterstützen</a></p>
<p style="color:#5b6b7b;font-size:13px">Wenn du nichts tust, werden sie zum genannten Datum entfernt.</p>
</body></html>`;
  const subject = shares.length === 1 ? `${app}: Ein Törn wird bald gelöscht` : `${app}: ${shares.length} Törns werden bald gelöscht`;
  return { to, subject, text, html };
}

/**
 * Saison-Erinnerung im Dezember (Konzept 5.5): freundlich, einmal pro Konto und Jahr – die Törns der Saison bleiben
 * bis Ende Januar; wer sie behalten will, unterstützt das private Projekt für die nächste Saison.
 */
export function seasonReminderMail(env: Env, to: string, origin: string, m: { season: number; voyages: number; expiresAt: number }): Mail {
  const app = env.APP_NAME;
  const date = new Date(m.expiresAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const what = m.voyages === 1 ? 'dein Törn' : `deine ${m.voyages} Törns`;
  const link = `${origin}/?support=open`;
  const next = m.season + 1;
  const text = `Hallo,

die Saison ${m.season} geht zu Ende – danke, dass du ${what} bei ${app} geteilt hast!

${app} ist ein privates Projekt aus Potsdam: ohne Werbung, ohne Tracking, gebaut in der Freizeit. Server, Speicher und Karten kosten trotzdem Geld. Deshalb bleiben kostenlose Törns eine Saison lang gespeichert – ${what} also bis zum ${date}.

Wenn du sie in die Saison ${next} mitnehmen möchtest, freue ich mich über eine kleine Unterstützung – schon ein Kaffee reicht, und für die ganze Saison ${next} kannst du dann auch Fotos hochladen und die Sichtbarkeit selbst wählen:
${link}

Kein Muss: Wenn du nichts tust, werden die Törns am ${date} entfernt, dein Konto bleibt.

Frohe Weihnachten und immer eine Handbreit Wasser unterm Kiel!
`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>die Saison ${m.season} geht zu Ende – danke, dass du ${what} bei <b>${app}</b> geteilt hast!</p>
<p>${app} ist ein privates Projekt aus Potsdam: ohne Werbung, ohne Tracking, gebaut in der Freizeit. Server, Speicher und Karten kosten trotzdem Geld. Deshalb bleiben kostenlose Törns eine Saison lang gespeichert – ${what} also bis zum <b>${date}</b>.</p>
<p>Wenn du sie in die Saison ${next} mitnehmen möchtest, freue ich mich über eine kleine Unterstützung – schon ein Kaffee reicht, und für die ganze Saison ${next} kannst du dann auch Fotos hochladen und die Sichtbarkeit selbst wählen.</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Saison ${next} unterstützen</a></p>
<p style="color:#5b6b7b;font-size:13px">Kein Muss: Wenn du nichts tust, werden die Törns am ${date} entfernt, dein Konto bleibt.</p>
<p>Frohe Weihnachten und immer eine Handbreit Wasser unterm Kiel!</p>
</body></html>`;
  return { to, subject: `${app}: Deine Saison ${m.season} – mitnehmen in die nächste?`, text, html };
}

/** Neuer Passkey am Konto (Konzept 14.7) – damit ein unbemerkt hinterlegter Zugang auffällt. Name ist Nutzertext. */
export function passkeyAddedMail(env: Env, to: string, origin: string, name: string): Mail {
  const app = env.APP_NAME;
  const link = `${origin}/?konto=einstellungen`;
  const text = `Hallo,\n\nan deinem Konto bei ${app} wurde ein neuer Passkey angelegt: „${name}“. Damit kann man sich ohne Mail anmelden.\n\nWarst du das nicht? Entferne den Passkey im Konto unter „Einstellungen“ und melde dich auf allen Geräten neu an:\n${link}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>an deinem Konto bei <b>${app}</b> wurde ein neuer Passkey angelegt: <b>„${escapeHtml(name)}“</b>. Damit kann man sich ohne Mail anmelden.</p>
<p style="color:#5b6b7b;font-size:13px">Warst du das nicht? Entferne den Passkey im Konto unter „Einstellungen“.</p>
<p><a href="${link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Zu den Einstellungen</a></p>
</body></html>`;
  return { to, subject: `${app}: Neuer Passkey an deinem Konto`, text, html };
}

export interface InviteMailInput {
  kind: 'boat_admin' | 'crew' | 'group' | 'friend';
  /** nur bei Gruppen: Verein oder Team */
  groupKind?: 'club' | 'team';
  /** nur bei Crew: Rolle, als die eingeladen wird (Konzept 15) */
  role?: VoyageRole;
  /** Anzeigename des Einladenden (selbst gewählt oder Spaßname) – nie die E-Mail-Adresse */
  inviter: string;
  /** Boots- bzw. Törnname (Nutzertext) */
  target: string;
  link: string;
  days: number;
}

/** Einladung als Boots-Admin bzw. in die Crew eines Törns (Konzept 10.4). Namen sind Nutzertext → gekürzt und escaped. */
export function inviteMail(env: Env, to: string, m: InviteMailInput): Mail {
  const app = env.APP_NAME;
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const who = short(m.inviter.trim() || 'Ein Segler oder eine Seglerin', 60);
  const group = m.groupKind === 'team' ? 'das Team' : 'den Verein';
  const target = short(m.target.trim() || (m.kind === 'crew' ? 'Törn' : m.kind === 'group' ? 'Gruppe' : 'Boot'), 80);
  // „als Gast“ usw. – feste Texte, kein Nutzertext
  const asRole = m.role && m.role !== 'crew' ? `als ${VOYAGE_ROLE_SHORT[m.role]} ` : '';
  const what =
    m.kind === 'friend'
      ? `zu ${app} ein – Törns teilen, Boote, Vereine und Teams rund ums Segeln`
      : m.kind === 'boat_admin' ? `das Boot „${target}“ bei ${app} mitzuverwalten` : m.kind === 'group' ? `in ${group} „${target}“ bei ${app}` : `${asRole}in die Crew des Törns „${target}“ bei ${app}`;
  const whatHtml =
    m.kind === 'friend'
      ? `zu <b>${app}</b> ein – Törns teilen, Boote, Vereine und Teams rund ums Segeln`
      : m.kind === 'boat_admin'
      ? `das Boot <b>„${escapeHtml(target)}“</b> bei <b>${app}</b> mitzuverwalten`
      : m.kind === 'group'
        ? `in ${group} <b>„${escapeHtml(target)}“</b> bei <b>${app}</b>`
        : `${asRole}in die Crew des Törns <b>„${escapeHtml(target)}“</b> bei <b>${app}</b>`;
  const verb = m.kind === 'boat_admin' ? 'lädt dich ein,' : m.kind === 'friend' ? 'lädt dich' : 'lädt dich ein';
  const after =
    m.kind === 'friend'
      ? 'Nimmst du an, folgt ihr einander und seht eure Neuigkeiten.'
      : m.kind === 'boat_admin'
      ? 'Als Admin kannst du die Bootsseite bearbeiten und deine Törns dem Boot zuordnen.'
      : m.kind === 'group'
        ? 'Als Mitglied siehst du die Neuigkeiten der Gruppe und kannst deine Boote zuordnen.'
        : 'Mit deinem Profil erscheinst du dann auf dem Törn, sobald er öffentlich ist.';
  const foot = `Die Einladung ist ${m.days} Tage gültig. Zum Annehmen meldest du dich mit dieser E-Mail-Adresse an. Wenn du niemanden kennst, ignoriere diese Mail einfach.`;
  const text = `Hallo,\n\n${who} ${verb} ${what}.\n${after}\n\nEinladung ansehen:\n${m.link}\n\n${foot}\n`;
  // Link stammt aus unserer eigenen Origin + base64url-Token, enthält also keine HTML-Sonderzeichen.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p><b>${escapeHtml(who)}</b> ${verb} ${whatHtml}.<br>${after}</p>
<p><a href="${m.link}" style="display:inline-block;background:#0e6bd8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Einladung ansehen</a></p>
<p style="color:#5b6b7b;font-size:13px">${foot}</p>
</body></html>`;
  const subject =
    m.kind === 'friend'
      ? `${who} lädt dich zu ${app} ein`
      : m.kind === 'boat_admin'
      ? `${app}: Einladung als Admin für „${target}“`
      : m.kind === 'group'
        ? `${app}: Einladung in „${target}“`
        : `${app}: Einladung in die Crew von „${target}“`;
  return { to, subject, text, html };
}

/**
 * Tägliche Sammelmail über Ungelesenes aus der Glocke (Konzept 17.6, opt-in je Art). Nur Anzahlen und eigene
 * Gegenstände – keine Namen, keine Texte anderer. Zeilen enthalten Nutzertext (Titel) → escaped; Pfade vom Server.
 */
export function notificationDigestMail(env: Env, to: string, origin: string, items: Array<{ line: string; path: string }>): Mail {
  const app = env.APP_NAME;
  const n = items.length === 1 ? 'eine neue Benachrichtigung' : `${items.length} neue Benachrichtigungen`;
  const foot = `Du bekommst diese Mail, weil du für diese Benachrichtigungen „Mail“ gewählt hast. Was du auf der Seite schon gelesen hast, kommt nicht per Mail. Ändern: ${origin}/?konto=einstellungen`;
  const lines = items.map((i) => `• ${i.line}\n  ${origin}${i.path}`).join('\n');
  const text = `Hallo,\n\nbei ${app} gibt es ${n} für dich:\n\n${lines}\n\n${foot}\n`;
  const list = items.map((i) => `<li><a href="${origin}${i.path}" style="color:#0e6bd8">${escapeHtml(i.line)}</a></li>`).join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>bei <b>${app}</b> gibt es ${n} für dich:</p><ul>${list}</ul>
<p style="color:#5b6b7b;font-size:13px">${escapeHtml(foot)}</p>
</body></html>`;
  return { to, subject: `${app}: ${n.charAt(0).toUpperCase()}${n.slice(1)}`, text, html };
}

export interface GroupDigestItem {
  /** Gruppenname (Nutzertext) */
  name: string;
  path: string;
  voyages: number;
  photos: number;
  posts: number;
  members: number;
}

/**
 * Wöchentliche Sammelmail „Was war los in deinem Verein“ (Konzept 11.7, opt-in). Nur Gruppen und Anzahlen – keine
 * Beitragstexte, keine Namen. Gruppennamen sind Nutzertext → gekürzt und escaped; Pfade stammen vom Server.
 */
export function groupDigestMail(env: Env, to: string, origin: string, groups: GroupDigestItem[]): Mail {
  const app = env.APP_NAME;
  const short = (s: string) => {
    const t = s.trim() || 'Gruppe';
    return t.length > 80 ? `${t.slice(0, 79)}…` : t;
  };
  const counts = (g: GroupDigestItem) =>
    [
      g.voyages && (g.voyages === 1 ? '1 neuer Törn' : `${g.voyages} neue Törns`),
      g.photos && (g.photos === 1 ? '1 neues Foto' : `${g.photos} neue Fotos`),
      g.posts && (g.posts === 1 ? '1 Beitrag' : `${g.posts} Beiträge`),
      g.members && (g.members === 1 ? '1 neues Mitglied' : `${g.members} neue Mitglieder`),
    ]
      .filter(Boolean)
      .join(', ');
  const foot = `Du bekommst diese Mail, weil du die wöchentliche Sammelmail eingeschaltet hast. Abschalten: ${origin}/ → Konto → Einstellungen.`;
  const lines = groups.map((g) => `• ${short(g.name)}: ${counts(g)}\n  ${origin}${g.path}`).join('\n');
  const text = `Hallo,\n\ndas war los in deinen Vereinen und Teams bei ${app} in den letzten 7 Tagen:\n\n${lines}\n\n${foot}\n`;
  const list = groups.map((g) => `<li><a href="${origin}${g.path}" style="color:#0e6bd8">${escapeHtml(short(g.name))}</a>: ${counts(g)}</li>`).join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f1d2b;line-height:1.5">
<p>Hallo,</p><p>das war los in deinen Vereinen und Teams bei <b>${app}</b> in den letzten 7 Tagen:</p><ul>${list}</ul>
<p style="color:#5b6b7b;font-size:13px">${foot}</p>
</body></html>`;
  return { to, subject: `${app}: Was war los in deinem Verein`, text, html };
}

/**
 * Fußzeile jeder Mail mit Impressum und Datenschutz (Konzept 12.7, F-183). Origin aus APP_ORIGIN (Konfiguration,
 * kein Nutzertext); ohne Konfiguration keine Fußzeile (keine fest eingebaute Domain).
 */
export function withLegalFooter(mail: Mail, origin: string): Mail {
  const base = origin.replace(/\/+$/, '');
  const text = `${mail.text}\n--\nImpressum: ${base}/impressum\nDatenschutz: ${base}/datenschutz\n`;
  const foot = `<p style="color:#8a97a5;font-size:12px;border-top:1px solid #e3e8ee;padding-top:8px;margin-top:24px"><a href="${base}/impressum" style="color:#8a97a5">Impressum</a> · <a href="${base}/datenschutz" style="color:#8a97a5">Datenschutz</a></p>`;
  const html = mail.html.includes('</body>') ? mail.html.replace('</body>', `${foot}\n</body>`) : `${mail.html}${foot}`;
  return { ...mail, text, html };
}

export async function sendMail(env: Env, plain: Mail): Promise<void> {
  // Nur mit konfigurierter Adresse (APP_ORIGIN, je Umgebung) – keine fest eingebaute Domain.
  const mail = env.APP_ORIGIN ? withLegalFooter(plain, env.APP_ORIGIN) : plain;
  switch (env.MAIL_PROVIDER) {
    case 'resend': {
      if (!env.RESEND_API_KEY) throw new HttpError(503, 'mail_unconfigured', 'Mailversand ist nicht eingerichtet.');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        console.error('resend failed', res.status, await res.text());
        throw new HttpError(502, 'mail_failed', 'Die Mail konnte nicht versendet werden.');
      }
      return;
    }
    case 'cloudflare': {
      if (!env.EMAIL) throw new HttpError(503, 'mail_unconfigured', 'Mailversand ist nicht eingerichtet.');
      await env.EMAIL.send({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return;
    }
    default:
      // Lokale Entwicklung: Link landet im Worker-Log.
      console.log(`[mail:log] an ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}
