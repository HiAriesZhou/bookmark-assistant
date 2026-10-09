import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/product-links';

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date('2026-09-20T00:00:00.000Z');
  return [
    { url: SITE_URL, lastModified: updated, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/zh-CN`, lastModified: updated, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/privacy`, lastModified: updated, changeFrequency: 'yearly', priority: 0.4 },
    {
      url: `${SITE_URL}/zh-CN/privacy`,
      lastModified: updated,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ];
}
