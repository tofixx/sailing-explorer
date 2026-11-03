// Routen der Wertung (Konzept 32) – eigener Block, damit worker/index.ts nur eine Zeile braucht.
import type { Env } from './env';
import { createTemplate, deleteTemplate, getMyScoring, putScoringOptIn, updateTemplate } from './scoring';
import { getClubList } from './scoring-list';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

const ID = '([A-Za-z0-9]{1,40})';
const GROUP = '([A-Za-z0-9]{12,32})';

export const scoringRoutes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ['GET', /^\/api\/me\/scoring$/, (r, env) => getMyScoring(r, env)],
  ['POST', /^\/api\/scoring\/templates$/, (r, env) => createTemplate(r, env)],
  ['PATCH', new RegExp(`^/api/scoring/templates/${ID}$`), (r, env, [id]) => updateTemplate(r, env, id)],
  ['DELETE', new RegExp(`^/api/scoring/templates/${ID}$`), (r, env, [id]) => deleteTemplate(r, env, id)],
  ['PUT', new RegExp(`^/api/groups/${GROUP}/scoring$`), (r, env, [id]) => putScoringOptIn(r, env, id)],
  ['GET', new RegExp(`^/api/groups/${GROUP}/scoring$`), (r, env, [id]) => getClubList(r, env, id)],
];
