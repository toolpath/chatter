import type { ReactNode } from 'react';
import { docsUrl } from '../../utils/docsLinks';

interface DocsLinkProps {
  /** The docs page, for example 'guide/update#back-up' */
  page: string;
  children: ReactNode;
}

/** A link to a page of the Chatter docs. It opens in a new tab, so Chatter stays open. */
export function DocsLink({ page, children }: DocsLinkProps) {
  return (
    <a
      href={docsUrl(page)}
      target="_blank"
      rel="noreferrer"
      className="text-primary-text underline underline-offset-2 hover:text-primary-text-hover"
    >
      {children}
    </a>
  );
}
