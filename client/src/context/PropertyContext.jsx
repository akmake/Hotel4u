import { createContext, useContext, useEffect, useState } from 'react';
import { api as pmsApi } from '../utils/api';
import { useAuthStore } from '../stores/authStore';

const Ctx = createContext(null);

export function PropertyProvider({ children }) {
  const { isAuthenticated, user } = useAuthStore();

  const [property, setProperty] = useState(() =>
    user?.propertyId ? { _id: String(user.propertyId) } : null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadProperties = async () => {
      if (!isAuthenticated) {
        if (!cancelled) {
          setProperty(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled && user?.propertyId) {
        setProperty((prev) => {
          if (String(prev?._id || '') === String(user.propertyId)) return prev;
          return { ...(prev || {}), _id: String(user.propertyId) };
        });
      }

      setLoading(true);
      setError(null);

      try {
        const list = await pmsApi.get('/properties');
        if (cancelled) return;

        const properties = Array.isArray(list) ? list : [];
        if (!properties.length) {
          if (user?.propertyId) {
            setError('No active properties were returned, using your assigned property scope.');
          } else {
            setError('No active properties found. Run seed data or create a property.');
            setProperty(null);
          }
          return;
        }

        const selected = user?.propertyId
          ? (properties.find((p) => String(p._id) === String(user.propertyId)) || properties[0])
          : properties[0];

        setProperty(selected);
      } catch (err) {
        if (cancelled) return;

        if (user?.propertyId) {
          setProperty((prev) => ({ ...(prev || {}), _id: String(user.propertyId) }));
          setError(`Property list unavailable: ${err.message || 'Unauthorized'}`);
        } else {
          setProperty(null);
          setError(err.message || 'Server unavailable. Verify token and backend status.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadProperties();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.propertyId]);

  return (
    <Ctx.Provider value={{ property, propertyId: property?._id, loading, error }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProperty() {
  return useContext(Ctx);
}
