import { HTTP_UNAUTHORIZED, requestLoginCheck } from './client';

/**
 * POST a file as the raw body, and tell how much of it is sent (0 to 1).
 * fetch() cannot tell the progress of an upload, so this uses XMLHttpRequest.
 * Gives the reply as a Response, so the usual reply helpers work. Fails only when the connection stops.
 */
export function sendWithProgress(address: string, file: File, onProgress: (sent: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', address);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === HTTP_UNAUTHORIZED) requestLoginCheck();
      resolve(new Response(request.responseText, { status: request.status }));
    };
    request.onerror = () => reject(new Error('The upload stopped. Check the network, then try again.'));
    request.send(file);
  });
}
