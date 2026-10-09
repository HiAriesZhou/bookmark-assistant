import Image from 'next/image';
import { ASSET_PREFIX, CHROME_WEB_STORE_URL } from '@/lib/product-links';
import type { WebsiteCopy } from '@/lib/i18n';

export function FinalCTA({ copy }: { copy: WebsiteCopy }) {
  return (
    <section className="editorial-final-cta relative overflow-hidden bg-[#16181d] py-20 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_110%,rgba(245,158,11,0.24),transparent_45%)]" />
      <div className="relative mx-auto max-w-4xl px-6 text-white">
        <h2 className="text-4xl font-medium tracking-[-0.035em] md:text-5xl">
          {copy.finalCta.title}
        </h2>
        <p className="mx-auto mb-8 mt-6 max-w-2xl text-xl text-[#d0d5dd]">{copy.finalCta.body}</p>
        <a
          href={CHROME_WEB_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-7 py-3 font-semibold text-[#16181d] transition hover:-translate-y-0.5 hover:bg-[#fff8e7] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16181d]"
        >
          <Image
            className="mr-2 h-5 w-5"
            src={`${ASSET_PREFIX}/assets/chrome.svg`}
            width={20}
            height={20}
            alt=""
          />
          {copy.ctas.primary}
        </a>
      </div>
    </section>
  );
}
