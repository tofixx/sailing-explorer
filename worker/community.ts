// Routen für Kommentare, Melden und Moderation (Phase D) – als eigener Block, damit worker/index.ts nur eine Zeile braucht.
import type { Env } from './env';
import { createComment, deleteComment, getSettings, listComments, patchSettings, setPostCommentsMode, setSubscription } from './comments';
import type { ThreadKind } from '../src/domain/comment-thread';
import { createReport, decideReport, listReports, reportInfo, suspendUser } from './reports';
import { reportCount } from './report-notices';

const threadKind = (segment: string): ThreadKind => (segment === 'posts' ? 'post' : 'share');

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

export const communityRoutes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  // Verlauf: Törn bzw. Beitrag ohne Törn (Konzept 40)
  ['GET', /^\/api\/(shares|posts)\/([A-Za-z0-9]+)\/comments$/, (r, env, [k, id]) => listComments(r, env, threadKind(k), id)],
  ['POST', /^\/api\/(shares|posts)\/([A-Za-z0-9]+)\/comments$/, (r, env, [k, id]) => createComment(r, env, threadKind(k), id)],
  ['PUT', /^\/api\/(shares|posts)\/([A-Za-z0-9]+)\/comments\/subscription$/, (r, env, [k, id]) => setSubscription(r, env, threadKind(k), id)],
  ['PUT', /^\/api\/posts\/([A-Za-z0-9]+)\/comments\/mode$/, (r, env, [id]) => setPostCommentsMode(r, env, id)],
  ['DELETE', /^\/api\/comments\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteComment(r, env, id)],
  ['GET', /^\/api\/me\/settings$/, (r, env) => getSettings(r, env)],
  ['PATCH', /^\/api\/me\/settings$/, (r, env) => patchSettings(r, env)],
  ['POST', /^\/api\/reports$/, (r, env) => createReport(r, env)],
  ['GET', /^\/api\/reports\/info$/, (r, env) => reportInfo(r, env)],
  ['GET', /^\/api\/admin\/reports$/, (r, env) => listReports(r, env)],
  ['GET', /^\/api\/admin\/reports\/count$/, (r, env) => reportCount(r, env)],
  ['POST', /^\/api\/admin\/reports\/([A-Za-z0-9]+)$/, (r, env, [id]) => decideReport(r, env, id)],
  ['POST', /^\/api\/admin\/users\/([A-Za-z0-9]+)\/suspend$/, (r, env, [id]) => suspendUser(r, env, id)],
];
