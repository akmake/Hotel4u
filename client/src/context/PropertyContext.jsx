import { createContext, useContext, useEffect, useState } from 'react';

const Ctx = createContext(null);

export function PropertyProvider({ children }) {
  const [property, setProperty] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    fetch('/api/properties')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data.length > 0) setProperty(d.data[0]);
        else setError('לא נמצא מלון — הרץ npm run seed בשרת');
      })
      .catch(() => setError('שרת לא זמין — ודא ש-MongoDB ו-Server פועלים'))
      .finally(() => setLoading(false));
  }, []);

  return <Ctx.Provider value={{ property, propertyId: property?._id, loading, error }}>{children}</Ctx.Provider>;
}

export function useProperty() {
  return useContext(Ctx);
}
