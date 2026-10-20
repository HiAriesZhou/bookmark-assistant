import Image from 'next/image';
import { ASSET_PREFIX, CHROME_WEB_STORE_URL } from '@/lib/product-links';
import type { WebsiteCopy } from '@/lib/i18n';

export function FinalCTA({ copy }: { copy: WebsiteCopy }) {
  return (
    <section className="relative overflow-hidden bg-[#e5e4dd] py-20 text-center text-[#29352e]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_110%,rgba(109,132,99,.14),transparent_48%)]" />
      <div className="relative mx-auto max-w-4xl px-6 text-[#29352e]">
        <h2 className="text-4xl font-medium tracking-[-0.035em] md:text-5xl">
          {copy.finalCta.title}
        </h2>
        <p className="mx-auto mb-8 mt-6 max-w-2xl text-xl text-[#687065]">{copy.finalCta.body}</p>
        <a
          href={CHROME_WEB_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[rgba(90,99,86,.2)] bg-[#f8f9f6] px-7 py-3 font-semibold text-[#414a40] shadow-[0_4px_12px_rgba(48,57,42,.05)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#16181d]"
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
