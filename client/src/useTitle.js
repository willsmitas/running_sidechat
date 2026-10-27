import { useEffect } from 'react';

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Backstretch` : 'Backstretch';
  }, [title]);
}
