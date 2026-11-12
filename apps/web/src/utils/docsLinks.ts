/** The Chatter docs site. */
const DOCS_URL = 'https://toolpath.github.io/chatter';

/** The full address of a docs page, for example docsUrl('guide/update#back-up') */
export function docsUrl(page: string): string {
  return `${DOCS_URL}/${page}`;
}
