import { Hono, type Context } from 'hono';
import type { CurrentUser } from '../auth/Auth.js';
import { requirePermission, type LoggedInEnv } from '../auth/authRoutes.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { LastAdminError, UsernameTakenError } from '../auth/userStore.js';
import { checkedJson, checkedParam } from './checks.js';
import { notFound } from './responses.js';
import { addUserSchema, changeRoleSchema, setPasswordSchema, userIdParam } from './schemas.js';

/** What the Settings page shows on the "Users and roles" tab */
function usersReport(accounts: UserAccounts, me: CurrentUser) {
  return {
    users: accounts.list().map(user => ({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      isYou: user.id === me.id,
    })),
  };
}

/** Make the change. A change that the user rules do not allow gets a 409 reply. */
async function withRulesChecked(c: Context, change: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await change();
  } catch (error) {
    if (error instanceof UsernameTakenError || error instanceof LastAdminError) return c.json({ error: error.message }, 409);
    throw error;
  }
}

/** An admin changes other users here. You change your own password on the "Your account" tab. */
const notYourself = (c: Context, what: string) => c.json({ error: `You cannot ${what} here.` }, 400);

/** Add users, change their roles, set a new password for them, and remove them. Only an admin can do this. */
export function userSettingsRoutes(accounts: UserAccounts) {
  const canManageChatter = requirePermission('manage-chatter');
  const replyWithUsers = (c: Context<LoggedInEnv>) => c.json(usersReport(accounts, c.var.user));
  const unknownUser = (c: Context) => notFound(c, 'User');

  return new Hono<LoggedInEnv>()
    .get('/settings/users', canManageChatter, c => replyWithUsers(c))

    .post('/settings/users', canManageChatter, checkedJson(addUserSchema), c =>
      withRulesChecked(c, async () => {
        await accounts.add(c.req.valid('json'));
        return replyWithUsers(c);
      }),
    )

    .put('/settings/users/:id/role', canManageChatter, checkedParam(userIdParam), checkedJson(changeRoleSchema), c => {
      const { id } = c.req.valid('param');
      if (id === c.var.user.id) return notYourself(c, 'change your own role');
      return withRulesChecked(c, () => (accounts.changeRole(id, c.req.valid('json').role) ? replyWithUsers(c) : unknownUser(c)));
    })

    .put('/settings/users/:id/password', canManageChatter, checkedParam(userIdParam), checkedJson(setPasswordSchema), async c => {
      const { id } = c.req.valid('param');
      if (id === c.var.user.id) return notYourself(c, 'set your own password');
      if (!(await accounts.setPassword(id, c.req.valid('json').password))) return unknownUser(c);
      return replyWithUsers(c);
    })

    .delete('/settings/users/:id', canManageChatter, checkedParam(userIdParam), c => {
      const { id } = c.req.valid('param');
      if (id === c.var.user.id) return notYourself(c, 'remove yourself');
      return withRulesChecked(c, () => (accounts.remove(id) ? replyWithUsers(c) : unknownUser(c)));
    });
}
