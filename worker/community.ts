// Routen für Kommentare, Melden und Moderation (Phase D) – als eigener Block, damit worker/index.ts nur eine Zeile braucht.
import type { Env } from './env';
import { createComment, deleteComment, getSettings, listComments, patchSettings } from './comments';
import { createReport, decideReport, listReports, reportInfo, suspendUser } from './reports';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

export const communityRoutes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ['GET', /^\/api\/shares\/([A-Za-z0-9]+)\/comments$/, (r, env, [id]) => listComments(r, env, id)],
  ['POST', /^\/api\/shares\/([A-Za-z0-9]+)\/comments$/, (r, env, [id]) => createComment(r, env, id)],
  ['DELETE', /^\/api\/comments\/([A-Za-z0-9]+)$/, (r, env, [id]) => deleteComment(r, env, id)],
  ['GET', /^\/api\/me\/settings$/, (r, env) => getSettings(r, env)],
  ['PATCH', /^\/api\/me\/settings$/, (r, env) => patchSettings(r, env)],
  ['POST', /^\/api\/reports$/, (r, env) => createReport(r, env)],
  ['GET', /^\/api\/reports\/info$/, (r, env) => reportInfo(r, env)],
  ['GET', /^\/api\/admin\/reports$/, (r, env) => listReports(r, env)],
  ['POST', /^\/api\/admin\/reports\/([A-Za-z0-9]+)$/, (r, env, [id]) => decideReport(r, env, id)],
  ['POST', /^\/api\/admin\/users\/([A-Za-z0-9]+)\/suspend$/, (r, env, [id]) => suspendUser(r, env, id)],
];
