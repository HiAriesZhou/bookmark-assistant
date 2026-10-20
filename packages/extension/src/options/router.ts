import { useEffect, useRef, useState } from 'react';

export type RouteId = 'library' | 'destinations' | 'settings';

const defaultRoute: RouteId = 'library';

export const normalizeHash = (hash: string): RouteId => {
  const val = hash.replace(/^#\/?/, '').toLowerCase();
  if (val === 'organize') return 'library';
  if (['overview', 'connection', 'general'].includes(val)) return 'destinations';
  if (['billing', 'notifications', 'advanced', 'faq', 'tutorials', 'about'].includes(val)) {
    return 'settings';
  }
  const allowed: RouteId[] = ['library', 'destinations', 'settings'];
  return allowed.includes(val as RouteId) ? (val as RouteId) : defaultRoute;
};

export function useHashRoute(beforeNavigate?: () => boolean) {
  const [route, setRoute] = useState<RouteId>(() => normalizeHash(window.location.hash));
  const currentRoute = useRef(route);
  const guard = useRef(beforeNavigate);
  guard.current = beforeNavigate;

  useEffect(() => {
    const onHash = () => {
      const nextRoute = normalizeHash(window.location.hash);
      if (nextRoute === currentRoute.current) return;
      if (guard.current && !guard.current()) {
        window.history.replaceState(null, '', `#/${currentRoute.current}`);
        return;
      }
      currentRoute.current = nextRoute;
      setRoute(nextRoute);
    };
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.history.replaceState(null, '', `#/${defaultRoute}`);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (to: RouteId) => {
    if (to === currentRoute.current || (guard.current && !guard.current())) return;
    // Commit programmatic navigation immediately; history navigation uses the same guard.
    window.history.pushState(null, '', `#/${to}`);
    currentRoute.current = to;
    setRoute(to);
  };

  return { route, navigate } as const;
}
