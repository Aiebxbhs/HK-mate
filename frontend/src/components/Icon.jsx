const paths = {
  thermometer: 'M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0 M12 8v10 M10 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 1.5 1.5 M5 19l1.5-1.5 M17.5 6.5 1.5-1.5',
  coffee:
    'M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M16 9h2a3 3 0 0 1 0 6h-2 M7 2v3 M12 2v3 M3 22h16',
  walk: 'M13 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M8 22l3-7 3 3v4 M7 12l3-4 4 1 3 4h3 M11 9l-1 6',
  mountain: 'm2 21 8-16 5 10 2-5 5 11z M7 11l3 2 3-2',
  park: 'm12 2-7 9h4l-5 6h7v5h2v-5h7l-5-6h4z',
  book: 'M12 5v16 M3 3l9 2 9-2v16l-9 2-9-2z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3 M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8',
  museum: 'm3 8 9-5 9 5z M5 10v8 M10 10v8 M15 10v8 M20 10v8 M3 21h18',
  pin: 'M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13 M9 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  refresh: 'M20 10a8 8 0 0 0-14-4L3 9 M3 3v6h6 M4 14a8 8 0 0 0 14 4l3-3 M21 21v-6h-6',
  chevron: 'm6 9 6 6 6-6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'm6 6 12 12 M6 18 18 6',
  user: 'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  'mail-settings': 'M3 5h18v14H3z M3 5l9 8 9-8 M16 15h6 M19 12v6',
  checklist: 'M9 5h12 M9 12h12 M9 19h12 m-19-14 1 1 2-2 m-3 8 1 1 2-2 m-3 8 1 1 2-2',
  calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  mail: 'M3 5h18v14H3z M3 5l9 8 9-8',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  check: 'm5 12 4 4L19 6',
  logout: 'M9 4H4v16h5 M10 12h11m-5-5 5 5-5 5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  pen: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14z',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6',
}

export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.mail} />
    </svg>
  )
}
