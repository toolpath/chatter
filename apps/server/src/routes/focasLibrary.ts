import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requirePermission } from '../auth/authRoutes.js';
import { MAX_LIBRARY_BYTES } from '../machines/fanuc/focasLibraryFile.js';
import { LibraryFileError, type FocasLibraryInstaller } from '../machines/fanuc/focasLibraryInstaller.js';
import { checkedForm } from './checks.js';
import { focasLibraryForm } from './schemas.js';

/** Room for the form fields around the file */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** See, upload, and remove the FANUC FOCAS2 library. Only a user who manages the machines can do this. */
export function focasLibraryRoutes(installer: FocasLibraryInstaller) {
  const canManageMachines = requirePermission('manage-machines');
  const librarySizeLimit = bodyLimit({
    maxSize: MAX_LIBRARY_BYTES + FORM_OVERHEAD_BYTES,
    onError: c => c.json({ error: 'The file is too large for a FOCAS2 library.' }, 413),
  });

  return new Hono()
    .get('/focas/status', canManageMachines, async c => c.json(await installer.status()))

    .post('/focas/library', canManageMachines, librarySizeLimit, checkedForm(focasLibraryForm), async c => {
      const { file } = c.req.valid('form');
      try {
        return c.json(await installer.install(Buffer.from(await file.arrayBuffer())));
      } catch (error) {
        if (error instanceof LibraryFileError) return c.json({ error: error.message }, 400);
        throw error;
      }
    })

    .delete('/focas/library', canManageMachines, async c => c.json(await installer.remove()));
}
