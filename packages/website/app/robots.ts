import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/product-links';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/success'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

