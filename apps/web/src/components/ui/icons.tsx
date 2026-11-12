import type { ReactNode, SVGProps } from 'react';
import { rem } from './units';

/**
 * The line icons of the app. They take the text color (currentColor).
 * An icon is only a picture: the text next to it, or an aria-label, gives its meaning.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** The frame of every icon. A prop such as viewBox replaces the default. */
function LineIcon({ size = 16, strokeWidth = 1.75, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={rem(size)}
      height={rem(size)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const AlarmIcon = (props: IconProps) => (
  <LineIcon strokeWidth={1.8} {...props}><path d="M8 2.5l6 11H2z M8 6.5v3 M8 11.5v.5" /></LineIcon>
);

export const OfflineIcon = (props: IconProps) => (
  <LineIcon strokeWidth={1.8} {...props}>
    <path d="M2 2l12 12 M5.5 7.5a4 4 0 0 1 5 0 M3 5a7.5 7.5 0 0 1 3-1.6 M13 5a7.5 7.5 0 0 0-3.2-1.7 M8 12h.01" />
  </LineIcon>
);

/** A faint ring with a bright quarter. Give it a spin class, so that it turns. */
export const ConnectingIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}>
    <circle cx="8" cy="8" r="6" opacity=".3" />
    <path d="M8 2a6 6 0 0 1 6 6" />
  </LineIcon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}><path d="M4 6l4 4 4-4" /></LineIcon>
);

export const CheckIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}><path d="M3 8.5l3 3 7-7" /></LineIcon>
);

export const CloseIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}><path d="M4 4l8 8M12 4l-8 8" /></LineIcon>
);

export const SearchIcon = (props: IconProps) => (
  <LineIcon {...props}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></LineIcon>
);

export const PlusIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}><path d="M8 3v10M3 8h10" /></LineIcon>
);

export const UploadIcon = (props: IconProps) => (
  <LineIcon strokeWidth={2} {...props}><path d="M8 11V3M5 6l3-3 3 3M3 13h10" /></LineIcon>
);

export const DownloadIcon = (props: IconProps) => (
  <LineIcon {...props}><path d="M8 3v8M5 8l3 3 3-3M3 13h10" /></LineIcon>
);

export const TrashIcon = (props: IconProps) => (
  <LineIcon {...props}><path d="M3 4h10M6 4V3h4v1M4.5 4l.5 9h6l.5-9" /></LineIcon>
);

export const LogOutIcon = (props: IconProps) => (
  <LineIcon {...props}><path d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6" /></LineIcon>
);

export const RefreshIcon = (props: IconProps) => (
  <LineIcon {...props}><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></LineIcon>
);

export const FolderIcon = (props: IconProps) => (
  <LineIcon strokeWidth={1.5} {...props}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </LineIcon>
);

export const FolderUpIcon = (props: IconProps) => (
  <LineIcon strokeWidth={1.5} {...props}><path d="M8 12V5M5 8l3-3 3 3M3 3h10" /></LineIcon>
);

/** Waves going out from a point: look for something on the network */
export const ScanIcon = (props: IconProps) => (
  <LineIcon {...props}><path d="M8 12.5h.01 M5.5 10a3.5 3.5 0 0 1 5 0 M3 7.5a7 7 0 0 1 10 0" /></LineIcon>
);

/** A gear: the settings */
export const SettingsIcon = (props: IconProps) => (
  <LineIcon strokeWidth={1.5} {...props}>
    <path d="M12.76 6.86L14.54 7.12L14.54 8.88L12.76 9.14L12.18 10.56L13.25 12L12 13.25L10.56 12.18L9.14 12.76L8.88 14.54L7.12 14.54L6.86 12.76L5.44 12.18L4 13.25L2.75 12L3.82 10.56L3.24 9.14L1.46 8.88L1.46 7.12L3.24 6.86L3.82 5.44L2.75 4L4 2.75L5.44 3.82L6.86 3.24L7.12 1.46L8.88 1.46L9.14 3.24L10.56 3.82L12 2.75L13.25 4L12.18 5.44Z" />
    <circle cx="8" cy="8" r="2" />
  </LineIcon>
);

/** A machine tool: a column, a spindle head and a table. It is drawn on a larger grid than the other icons. */
export const MachinesIcon = (props: IconProps) => (
  <LineIcon viewBox="0 0 20 20" strokeWidth={1.9} {...props}>
    <path d="M2.5 17.5h15" />
    <path d="M4.5 17.5V3.5h6" />
    <rect x="10.5" y="2" width="5" height="5" rx="1" />
    <path d="M13 7v3" />
    <path d="M7.5 14h10" />
    <rect x="10.5" y="11.5" width="5" height="2.5" rx="0.5" />
    <path d="M12.5 14v3.5" />
  </LineIcon>
);

export const InfoIcon = (props: IconProps) => (
  <LineIcon {...props}><circle cx="8" cy="8" r="6" /><path d="M8 7.25v3.5 M8 5.25v.01" /></LineIcon>
);
