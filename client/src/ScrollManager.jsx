import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Remembers the scroll position of every history entry. Opening something new
// starts at the top; Back/Forward returns to where you were. The browser's own
// restoration is off because it runs before our content has loaded.
const positions = new Map();

export default function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  const currentKey = useRef(location.key);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positions.set(currentKey.current, window.scrollY);
        if (positions.size > 200) positions.delete(positions.keys().next().value);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Layout effect: runs right after the new page is in the DOM, before paint,
  // so scroll events from the page change are filed under the new entry.
  useLayoutEffect(() => {
    currentKey.current = location.key;
    if (navType !== 'POP') {
      if (!location.hash) window.scrollTo(0, 0);
      return undefined;
    }
    const target = positions.get(location.key) ?? 0;
    // Content may still be loading: keep trying until the page is tall enough,
    // and give up if the person starts scrolling themselves.
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    window.addEventListener('wheel', cancel, { passive: true, once: true });
    window.addEventListener('touchstart', cancel, { passive: true, once: true });
    window.addEventListener('keydown', cancel, { once: true });
    const deadline = performance.now() + 1500;
    let raf = 0;
    const attempt = () => {
      if (cancelled) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(target, Math.max(0, max)));
      if (max < target && performance.now() < deadline) raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
