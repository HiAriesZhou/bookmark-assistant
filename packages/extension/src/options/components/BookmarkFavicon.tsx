import { Globe2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export function BookmarkFavicon({ url, className = '' }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => {
    const base = globalThis.chrome?.runtime?.getURL?.('/_favicon/');
    return base ? `${base}?pageUrl=${encodeURIComponent(url)}&size=32` : '';
  }, [url]);

  if (!src || failed) {
    return <Globe2 aria-hidden="true" className={`text-library-faint ${className}`} />;
  }

  return (
    <img src={src} alt="" className={className} onError={() => setFailed(true)} loading="lazy" />
  );
}
