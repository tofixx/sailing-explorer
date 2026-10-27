// Routen für Vereine, Teams, Folgen und Neuigkeiten (Konzept 11) – eigener Block, damit worker/index.ts nur eine Zeile braucht.
import type { Env } from './env';
import {
  addGroupBoat, createGroup, decideRequest, deleteGroup, getGroup, listMyGroups, removeGroupBoat, removeMember, requestJoin,
  setMemberRole, updateGroup, withdrawRequest,
} from './groups';
import { inviteGroup } from './invites';
import { createPost, deletePost } from './posts';
import { groupStream, markStreamSeen, personalStream, streamUnread } from './stream';
import { follow, getSuggestions, unfollow } from './follows';
// ---- Verein, Hafen, Team und Reaktionen (Konzept 12) ----
import { createHarbor, getHarbor, searchHarbors, updateHarbor } from './harbors';
import { getMyHome, putMyHome } from './home';
import { deleteReaction, getReactions, putReaction } from './reactions';
import { harborStream, publicStream } from './stream';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

const ID = '([A-Za-z0-9]{12,32})';
const WHO = '([A-Za-z0-9]+)';

export const groupRoutes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ['GET', /^\/api\/groups$/, (r, env) => listMyGroups(r, env)],
  ['POST', /^\/api\/groups$/, (r, env) => createGroup(r, env)],
  ['GET', /^\/api\/groups\/slug\/([A-Za-z0-9-]{3,30})$/, (r, env, [slug]) => getGroup(r, env, slug, true)],
  ['GET', new RegExp(`^/api/groups/${ID}$`), (r, env, [id]) => getGroup(r, env, id, false)],
  ['PATCH', new RegExp(`^/api/groups/${ID}$`), (r, env, [id]) => updateGroup(r, env, id)],
  ['DELETE', new RegExp(`^/api/groups/${ID}$`), (r, env, [id]) => deleteGroup(r, env, id)],
  ['PATCH', new RegExp(`^/api/groups/${ID}/members/${WHO}$`), (r, env, [id, who]) => setMemberRole(r, env, id, who)],
  ['DELETE', new RegExp(`^/api/groups/${ID}/members/${WHO}$`), (r, env, [id, who]) => removeMember(r, env, id, who)],
  ['POST', new RegExp(`^/api/groups/${ID}/invites$`), (r, env, [id]) => inviteGroup(r, env, id)],
  ['POST', new RegExp(`^/api/groups/${ID}/requests$`), (r, env, [id]) => requestJoin(r, env, id)],
  ['DELETE', new RegExp(`^/api/groups/${ID}/requests/me$`), (r, env, [id]) => withdrawRequest(r, env, id)],
  ['POST', new RegExp(`^/api/groups/${ID}/requests/${WHO}$`), (r, env, [id, who]) => decideRequest(r, env, id, who)],
  ['POST', new RegExp(`^/api/groups/${ID}/boats$`), (r, env, [id]) => addGroupBoat(r, env, id)],
  ['DELETE', new RegExp(`^/api/groups/${ID}/boats/${ID}$`), (r, env, [id, boat]) => removeGroupBoat(r, env, id, boat)],
  ['POST', new RegExp(`^/api/groups/${ID}/posts$`), (r, env, [id]) => createPost(r, env, id)],
  ['GET', new RegExp(`^/api/groups/${ID}/stream$`), (r, env, [id]) => groupStream(r, env, id)],
  ['DELETE', new RegExp(`^/api/posts/${ID}$`), (r, env, [id]) => deletePost(r, env, id)],
  ['GET', /^\/api\/stream$/, (r, env) => personalStream(r, env)],
  ['GET', /^\/api\/stream\/unread$/, (r, env) => streamUnread(r, env)],
  ['POST', /^\/api\/stream\/seen$/, (r, env) => markStreamSeen(r, env)],
  ['GET', /^\/api\/me\/suggestions$/, (r, env) => getSuggestions(r, env)],
  ['PUT', /^\/api\/follows\/(user|boat|group|harbor)\/([A-Za-z0-9-]{3,32})$/, (r, env, [kind, id]) => follow(r, env, kind, id)],
  ['DELETE', /^\/api\/follows\/(user|boat|group|harbor)\/([A-Za-z0-9-]{3,32})$/, (r, env, [kind, id]) => unfollow(r, env, kind, id)],
  // ---- Konzept 12: öffentlicher Stream, Häfen, Heimat, Reaktionen ----
  ['GET', /^\/api\/stream\/public$/, (r, env) => publicStream(r, env)],
  ['GET', /^\/api\/harbors$/, (r, env) => searchHarbors(r, env)],
  ['POST', /^\/api\/harbors$/, (r, env) => createHarbor(r, env)],
  ['GET', /^\/api\/harbors\/slug\/([a-z0-9-]{1,100})$/, (r, env, [slug]) => getHarbor(r, env, slug)],
  ['PATCH', new RegExp(`^/api/harbors/${ID}$`), (r, env, [id]) => updateHarbor(r, env, id)],
  ['GET', new RegExp(`^/api/harbors/${ID}/stream$`), (r, env, [id]) => harborStream(r, env, id)],
  ['GET', /^\/api\/me\/home$/, (r, env) => getMyHome(r, env)],
  ['PUT', /^\/api\/me\/home$/, (r, env) => putMyHome(r, env)],
  ['GET', new RegExp(`^/api/reactions/(share|post|photo|activity)/${ID}$`), (r, env, [kind, id]) => getReactions(r, env, kind, id)],
  ['PUT', new RegExp(`^/api/reactions/(share|post|photo|activity)/${ID}$`), (r, env, [kind, id]) => putReaction(r, env, kind, id)],
  ['DELETE', new RegExp(`^/api/reactions/(share|post|photo|activity)/${ID}$`), (r, env, [kind, id]) => deleteReaction(r, env, kind, id)],
];
