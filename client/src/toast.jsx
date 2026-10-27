import { createContext, useCallback, useContext, useState } from 'react';

const Ctx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((text, kind = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
