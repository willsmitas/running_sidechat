const PATHS = {
  up: 'M12 4l7 8h-4.5v8h-5v-8H5z',
  down: 'M12 20l-7-8h4.5V4h5v8H19z',
  comment: 'M4 5h16v11H8l-4 4z',
  home: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  bell: 'M12 3a6 6 0 016 6v4l2 3H4l2-3V9a6 6 0 016-6zm-2 15h4a2 2 0 01-4 0z',
  chat: 'M4 4h16v12H9l-5 4zM8 9h8M8 12h5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 8c0-4 4-6 8-6s8 2 8 6z',
  search: 'M10 4a6 6 0 104.47 10.03L20 19.5 19.5 20l-5.47-5.53A6 6 0 0010 4z',
  lock: 'M7 10V8a5 5 0 0110 0v2h1v10H6V10zm2 0h6V8a3 3 0 00-6 0z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  more: 'M5 10.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  share: 'M12 3l4 4h-3v7h-2V7H8zM5 12h2v6h10v-6h2v8H5z',
  flag: 'M5 3h2v18H5zM8 4h10l-2 4 2 4H8z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7z',
  image: 'M4 5h16v14H4zm2 12h12l-4-5-3 4-2-2zM8.5 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
  poll: 'M5 13h3v7H5zM10.5 4h3v16h-3zM16 9h3v11h-3z',
  shield: 'M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5z',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l4 4 10-10',
  school: 'M12 3l10 5-10 5L2 8zm-6 8v4c2 2 4 3 6 3s4-1 6-3v-4l-6 3z',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  pin: 'M9 3h6l-1 6 3 3v2h-4v7h-2v-7H7v-2l3-3z',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 5.5l-2 .3a7 7 0 01-.7 1.6l1.2 1.7-2 2-1.7-1.2a7 7 0 01-1.6.7l-.3 2h-2.8l-.3-2a7 7 0 01-1.6-.7l-1.7 1.2-2-2 1.2-1.7a7 7 0 01-.7-1.6l-2-.3v-2.8l2-.3a7 7 0 01.7-1.6L4.8 6.8l2-2 1.7 1.2a7 7 0 011.6-.7l.3-2h2.8l.3 2a7 7 0 011.6.7l1.7-1.2 2 2-1.2 1.7a7 7 0 01.7 1.6l2 .3z',
};

const STROKED = new Set(['back', 'close', 'check', 'chat', 'mute']);

export default function Icon({ name, size = 20, className = '', title }) {
  const d = PATHS[name];
  const stroked = STROKED.has(name);
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      fill={stroked ? 'none' : 'currentColor'}
      stroke={stroked ? 'currentColor' : 'none'}
      strokeWidth={stroked ? 2.2 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
