// Galerien (Konzept 13.1): Fotos hängen am Törn; Person, Boot und Verein/Team zeigen die neuesten Fotos ihrer Törns.
// Nur effektiv öffentliche Fotos (Foto „wie der Törn“, Törn öffentlich, beides nicht ausgeblendet, Konto nicht
// gesperrt) – die Galerie macht nichts sichtbarer, als es am Törn schon ist.
import type { Env } from './env';
import { GALLERY_PHOTOS } from '../src/domain/limits';

export type GalleryOf = 'user' | 'boat' | 'group';

export interface GalleryPhoto {
  id: string;
  shareId: string;
  shareTitle: string;
  caption: string;
  takenAt: number | null;
  width: number;
  height: number;
}

/** Welche Törns gehören dazu (Bind-Parameter ?1 = ID). Person: eigene und mitgesegelte; Gruppe: Boote und Mitglieder. */
const SCOPE: Record<GalleryOf, string> = {
  user: '(s.user_id = ?1 OR EXISTS (SELECT 1 FROM share_crew c WHERE c.share_id = s.id AND c.user_id = ?1))',
  boat: 's.boat_id = ?1',
  group: `(s.boat_id IN (SELECT boat_id FROM group_boats WHERE group_id = ?1)
    OR s.user_id IN (SELECT user_id FROM group_members WHERE group_id = ?1))`,
};

export async function galleryPhotos(env: Env, of: GalleryOf, id: string, limit = GALLERY_PHOTOS): Promise<GalleryPhoto[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.share_id, s.title, p.caption, p.taken_at, p.width, p.height
     FROM photos p JOIN shares s ON s.id = p.share_id
     WHERE ${SCOPE[of]}
       AND p.visibility = 'public' AND p.hidden_at IS NULL AND s.visibility = 'public' AND s.hidden_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.suspended_at IS NOT NULL)
     ORDER BY COALESCE(p.taken_at, p.created_at) DESC LIMIT ?2`,
  )
    .bind(id, limit)
    .all<{ id: string; share_id: string; title: string; caption: string; taken_at: number | null; width: number; height: number }>();
  return results.map((r) => ({ id: r.id, shareId: r.share_id, shareTitle: r.title, caption: r.caption, takenAt: r.taken_at, width: r.width, height: r.height }));
}
