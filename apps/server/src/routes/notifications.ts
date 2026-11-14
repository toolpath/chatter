import { NOTIFICATION_MESSAGE_DAYS } from '@local-chatter/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requirePermission } from '../auth/authRoutes.js';
import { channelTypeInfos } from '../notifications/channels/index.js';
import type { Notifications } from '../notifications/Notifications.js';
import { checkedJson, checkedParam, checkedQuery } from './checks.js';
import { channelIdParam, channelInputSchema, notificationMessagesQuery, notificationSettingsSchema } from './schemas.js';

const KEEP_MS = NOTIFICATION_MESSAGE_DAYS * 24 * 60 * 60_000;
const CHANNEL_NOT_THERE = 'The channel is not there. Maybe someone deleted it.';
/** A channel form or the settings is a few kilobytes. A larger body is refused before it is read into memory. */
const MAX_BODY_BYTES = 64 * 1024;
const smallBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: c => c.json({ error: 'The body is too large' }, 413) });

/**
 * Settings > Notifications: the channels, the messages of the last 30 days, "Send test", and the settings.
 * Only an admin can see them, because a channel has the phone numbers of the shop and the web addresses of its services.
 */
export function notificationRoutes(notifications: Notifications, now: () => number = Date.now) {
  const canManageChatter = requirePermission('manage-chatter');
  const { channels, outbox, settings } = notifications;
  return new Hono()
    .get('/notification-types', canManageChatter, c => c.json(channelTypeInfos()))

    .get('/notification-channels', canManageChatter, c => c.json(channels.list()))

    .post('/notification-channels', canManageChatter, smallBody, checkedJson(channelInputSchema), c => {
      const result = channels.add(c.req.valid('json'), now());
      return result.ok ? c.json(result.channel, 201) : c.json({ error: result.error }, 400);
    })

    // Before the save, so that "test" is not read as a channel id
    .post('/notification-channels/test', canManageChatter, smallBody, checkedJson(channelInputSchema), async c =>
      c.json(await notifications.sendTest(c.req.valid('json'))))

    .put('/notification-channels/:id', canManageChatter, smallBody, checkedParam(channelIdParam), checkedJson(channelInputSchema), c => {
      const { id } = c.req.valid('param');
      if (!channels.get(id)) return c.json({ error: CHANNEL_NOT_THERE }, 404);
      const result = channels.update(id, c.req.valid('json'));
      return result.ok ? c.json(result.channel) : c.json({ error: result.error }, 400);
    })

    .delete('/notification-channels/:id', canManageChatter, checkedParam(channelIdParam), c => {
      if (!notifications.removeChannel(c.req.valid('param').id)) return c.json({ error: CHANNEL_NOT_THERE }, 404);
      return c.body(null, 204);
    })

    // The form of a saved channel: an empty secret uses the saved secret. The result goes in the message list.
    .post('/notification-channels/:id/test', canManageChatter, smallBody, checkedParam(channelIdParam), checkedJson(channelInputSchema), async c => {
      const { id } = c.req.valid('param');
      if (!channels.get(id)) return c.json({ error: CHANNEL_NOT_THERE }, 404);
      return c.json(await notifications.sendTest(c.req.valid('json'), id));
    })

    .get('/notification-messages', canManageChatter, checkedQuery(notificationMessagesQuery), c => {
      const { channel } = c.req.valid('query');
      return c.json(outbox.list({ channelId: channel, since: now() - KEEP_MS }));
    })

    .get('/notification-settings', canManageChatter, c => c.json(settings.get()))

    .put('/notification-settings', canManageChatter, smallBody, checkedJson(notificationSettingsSchema), c => {
      settings.save(c.req.valid('json'));
      return c.json(settings.get());
    });
}
