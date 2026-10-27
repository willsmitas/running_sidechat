const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

// Renders plain text with clickable links and preserved line breaks. No HTML
// from users is ever rendered.
export default function Linkify({ text }) {
  const parts = String(text || '').split(URL_RE);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow ugc" onClick={(e) => e.stopPropagation()}>
        {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}{p.length > 70 ? '…' : ''}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
