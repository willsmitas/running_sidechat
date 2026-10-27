import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Small overflow ("⋯") menu. items: [{ label, icon, onClick, danger, hidden }]
export default function Menu({ items, label = 'More options', icon = 'more' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn" aria-label={label} aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        <Icon name={icon} size={icon === 'more' ? 20 : 17} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {visible.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={`menu-item ${i.danger ? 'danger' : ''}`}
              onClick={(e) => { e.preventDefault(); setOpen(false); i.onClick(); }}
            >
              {i.icon && <Icon name={i.icon} size={16} />} {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
