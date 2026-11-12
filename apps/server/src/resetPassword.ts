/**
 * Remove the admin accounts, for when no admin knows their password.
 * Every browser is logged out. The users who are not admins stay.
 * After this, the next person who opens Chatter makes a new admin account.
 *
 *   docker compose exec chatterbox npm run reset-password
 */
import 'dotenv/config';
import { SessionStore } from './auth/sessionStore.js';
import { UserStore } from './auth/userStore.js';
import { closeDatabase, getDb } from './storage/database.js';

new UserStore(getDb()).removeAdmins();
new SessionStore(getDb()).deleteAll();
await closeDatabase();
console.log('The admin accounts are removed. Open Chatter now and make a new admin account.');
