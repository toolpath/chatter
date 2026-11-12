/** The message of a thrown error, for the text the user sees. A thrown value that is not an Error gets `fallback`. */
export function errorMessageOf(error: unknown, fallback = 'unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}
