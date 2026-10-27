export default function Alias({ alias, size = 'md', showName = true }) {
  if (!alias) {
    return (
      <span className={`alias alias-${size}`}>
        <span className="alias-icon alias-ghost">·</span>
        {showName && <span className="alias-name muted">deleted</span>}
      </span>
    );
  }
  return (
    <span className={`alias alias-${size}`}>
      <span className="alias-icon" style={{ background: alias.color }} aria-hidden>{alias.emoji}</span>
      {showName && <span className={`alias-name ${alias.isOp ? 'alias-op' : ''}`}>{alias.name}</span>}
    </span>
  );
}
