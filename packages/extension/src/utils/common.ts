export const formatLastUpdated = () =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date());

export const relativeTime = (iso?: string, locale = 'en') => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (mins < 1) return formatter.format(0, 'minute');
  if (mins < 60) return formatter.format(-mins, 'minute');
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return formatter.format(-hrs, 'hour');
  const days = Math.floor(hrs / 24);
  return formatter.format(-days, 'day');
};
