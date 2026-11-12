import { useState } from 'react';

/** The last upload result. The upload panel shows it, and the history card can set it too. */
export function useUploadMessages() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clear = () => {
    setError(null);
    setSuccess(null);
  };

  return { error, success, setError, setSuccess, clear };
}

export type UploadMessages = ReturnType<typeof useUploadMessages>;
