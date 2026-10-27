import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from './api.js';

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, site: { name: 'Backstretch' }, boards: [] });

  const refresh = useCallback(async () => {
    try {
      const [me, b] = await Promise.all([get('/me'), get('/boards')]);
      setState({ loading: false, user: me.user, site: me.site, boards: b.boards });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await get('/me');
      setState((s) => ({ ...s, user: me.user, site: me.site }));
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll for unread notifications/chats while the tab is visible.
  useEffect(() => {
    if (!state.user) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshMe();
    }, 30_000);
    const onVis = () => document.visibilityState === 'visible' && refreshMe();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state.user, refreshMe]);

  const setBoard = useCallback((slug, patch) => {
    setState((s) => ({ ...s, boards: s.boards.map((b) => (b.slug === slug ? { ...b, ...patch } : b)) }));
  }, []);

  const value = useMemo(() => ({ ...state, refresh, refreshMe, setBoard }), [state, refresh, refreshMe, setBoard]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
