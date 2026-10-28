import type { Metadata } from 'next';
import { CheckCircle, ExternalLink } from 'lucide-react';
import { CHROME_WEB_STORE_URL, SITE_URL, PRODUCT_NAME } from '@/lib/product-links';

// Older extension versions may still send visitors here; the page stays neutral.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: PRODUCT_NAME,
  description: `${PRODUCT_NAME} is now free and open source.`,
  alternates: { canonical: '/success' },
  robots: { index: false, follow: false },
};

// Builds without a store listing link to the home page's source section instead.
const INSTALL_HREF = CHROME_WEB_STORE_URL.startsWith('#')
  ? `/${CHROME_WEB_STORE_URL}`
  : CHROME_WEB_STORE_URL;

export default function SuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#ffefbe,transparent_45%),#f6f7f9] px-6 py-16">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#e8eaed] bg-white p-8 text-center shadow-[0_30px_90px_rgba(24,27,33,0.13)] sm:p-12">
        <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#181b21] text-white shadow-lg">
          <CheckCircle className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#946200]">
          GPL-3.0-only
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[#16181d]">
          {PRODUCT_NAME} is now free
        </h1>
        <p className="mx-auto mt-5 max-w-md text-lg leading-8 text-[#667085]">
          Every feature is free and open source. Update the extension from the Chrome Web Store to
          get the latest version.
        </p>
        <a
          href={INSTALL_HREF}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#181b21] px-6 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#292d35] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00] focus-visible:ring-offset-2"
        >
          Open Chrome Web Store
          <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}
