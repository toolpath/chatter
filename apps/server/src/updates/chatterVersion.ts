/** The version when nothing set it, for example with "npm run dev" */
const DEVELOPMENT_VERSION = 'development';

/**
 * The version of this Chatter. The image build sets CHATTER_VERSION:
 * a release tag gives "1.2.0", a build from main gives "edge-<commit>".
 * Only a release version can update from the web app (see isReleaseVersion).
 */
export function chatterVersion(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.CHATTER_VERSION?.trim() || DEVELOPMENT_VERSION;
}
