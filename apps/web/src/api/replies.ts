/** The reply as JSON, or an error with the server's reason when the reply failed */
export async function jsonOrThrow<T>(response: Response, failureMessage: string): Promise<T> {
  const error = await errorOf(response, failureMessage);
  if (error) throw new Error(error);
  return response.json();
}

/** The error text of a failed reply, or null when the reply is good */
export async function errorOf(response: Response, fallback: string): Promise<string | null> {
  if (response.ok) return null;
  // A proxy can send a page that is not JSON. Then the fallback text is used.
  const body: { error?: string } = await response.json().catch(() => ({}));
  return body.error || fallback;
}
