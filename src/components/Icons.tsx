import type { CSSProperties } from 'react';

export function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    step: (
      <>
        <path d="m5 5 11 7-11 7zM20 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" />
      </>
    ),
    wrench: (
      <>
        <path d="m14 5 4 4M13 3a6 6 0 0 0-7 7L2 14l4 4 4-4a6 6 0 0 0 7-7l-4 4-3-3z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v7M12 7v.1" />
      </>
    ),
    route: (
      <>
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h6" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    code: (
      <>
        <path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}

export function DeviceGlyph({ kind }: { kind: string }) {
  if (kind === 'client')
    return (
      <>
        <rect x="-13" y="-10" width="26" height="18" rx="2" />
        <path d="M-18 13h36M-7 8v5M7 8v5" />
      </>
    );
  if (kind === 'firewall')
    return (
      <>
        <path d="m0-17 15 6v11c0 11-15 18-15 18S-15 11-15 0v-11z" />
        <path d="M-9-4H9M-11 3h22M-7 10H7M0-10v6M-5-4v7M5 3v7" />
      </>
    );
  if (kind === 'router')
    return (
      <>
        <rect x="-17" y="-10" width="34" height="23" rx="4" />
        <path d="M-10-17v7M10-17v7M-10 2h20M-7-2l-4 4 4 4M7-2l4 4-4 4" />
      </>
    );
  return (
    <>
      <rect x="-14" y="-17" width="28" height="34" rx="3" />
      <path d="M-14-6h28M-14 6h28M-7-12h1M-7 0h1M-7 12h1M1-12h7M1 0h7M1 12h7" />
    </>
  );
}
