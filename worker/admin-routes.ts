// Routen des Admin-Bereichs (Konzept 15) – als eigener Block, damit worker/index.ts nur eine Zeile braucht.
// Jeder Handler prüft selbst requireAdmin (404 für alle anderen).
import type { Env } from './env';
import { adminDelete, adminDetail, adminList, adminLock, adminLogList, adminOwner, adminRename, adminUnlock } from './admin';
import { mergeHarbor, mergeUserPreview, mergeUsers } from './admin-merge';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

const KIND = '(users|boats|groups|harbors|shares)';
const ID = '([A-Za-z0-9]+)';

export const adminRoutes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ['GET', new RegExp(`^/api/admin/list/([a-z]+)$`), (r, env, [k]) => adminList(r, env, k)],
  ['GET', /^\/api\/admin\/log$/, (r, env) => adminLogList(r, env)],
  ['POST', new RegExp(`^/api/admin/harbors/${ID}/merge$`), (r, env, [id]) => mergeHarbor(r, env, id)],
  ['GET', new RegExp(`^/api/admin/users/${ID}/merge$`), (r, env, [id]) => mergeUserPreview(r, env, id)],
  ['POST', new RegExp(`^/api/admin/users/${ID}/merge$`), (r, env, [id]) => mergeUsers(r, env, id)],
  ['PUT', new RegExp(`^/api/admin/${KIND}/${ID}/lock$`), (r, env, [k, id]) => adminLock(r, env, k, id)],
  ['DELETE', new RegExp(`^/api/admin/${KIND}/${ID}/lock$`), (r, env, [k, id]) => adminUnlock(r, env, k, id)],
  ['POST', new RegExp(`^/api/admin/${KIND}/${ID}/owner$`), (r, env, [k, id]) => adminOwner(r, env, k, id)],
  ['GET', new RegExp(`^/api/admin/${KIND}/${ID}$`), (r, env, [k, id]) => adminDetail(r, env, k, id)],
  ['PATCH', new RegExp(`^/api/admin/${KIND}/${ID}$`), (r, env, [k, id]) => adminRename(r, env, k, id)],
  ['DELETE', new RegExp(`^/api/admin/${KIND}/${ID}$`), (r, env, [k, id]) => adminDelete(r, env, k, id)],
];
