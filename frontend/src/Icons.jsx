export function Icon({ name, size = 20, ...props }) {
  const paths = {
    orbit: (
      <>
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="4.5"
          transform="rotate(-35 12 12)"
        />
        <circle cx="12" cy="12" r="4" />
        <circle cx="20" cy="7" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    chat: (
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6" />
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    hash: <path d="m9 3-2 18M17 3l-2 18M4 9h17M3 15h17" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    video: (
      <>
        <rect x="2" y="5" width="14" height="14" rx="4" />
        <path d="m16 10 6-4v12l-6-4" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v.1" />
      </>
    ),
    send: (
      <>
        <path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    exit: (
      <>
        <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M9 12h12m-5-5 5 5-5 5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4v2" />
      </>
    ),
    spark: (
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z" />
    ),
  }
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
      {...props}
    >
      {paths[name] || paths.chat}
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="orbit" size={27} />
      </span>
      <span>
        orbit<span className="brand-period">.</span>
      </span>
    </span>
  )
}
