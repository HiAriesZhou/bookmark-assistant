'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Check, Crown, Zap } from 'lucide-react';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { isWebsiteItemVisible, type WebsiteCopy, type WebsiteLocale } from '@/lib/i18n';
import { ASSET_PREFIX, CHROME_WEB_STORE_URL, DEFAULT_API_URL } from '@/lib/product-links';

type PricingData = {
  monthly: number;
  yearly: number;
  currencyCode: string;
  source: 'paddle' | 'configured-fallback';
};

async function fetchPricing(signal: AbortSignal): Promise<PricingData> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  const response = await fetch(`${apiUrl}/api/pricing`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Failed to fetch pricing');
  const data = (await response.json()) as { success?: boolean; pricing?: Partial<PricingData> };
  const pricing = data.pricing;
  if (
    !data.success ||
    !pricing ||
    typeof pricing.monthly !== 'number' ||
    typeof pricing.yearly !== 'number' ||
    typeof pricing.currencyCode !== 'string' ||
    pricing.source !== 'paddle'
  ) {
    throw new Error('Live Paddle pricing is unavailable');
  }
  return pricing as PricingData;
}
export function Pricing({ copy, locale }: { copy: WebsiteCopy; locale: WebsiteLocale }) {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    fetchPricing(controller.signal)
      .then(setPricing)
      .catch(() => setPricing(null))
      .finally(() => {
        window.clearTimeout(timeout);
        setIsLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const formattedPrice = useMemo(() => {
    if (!pricing) return null;
    return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency: pricing.currencyCode,
      minimumFractionDigits: pricing[billing] % 1 === 0 ? 0 : 2,
    }).format(pricing[billing]);
  }, [billing, locale, pricing]);

  const freeFeatures = copy.pricing.freeFeatures.filter(({ status }) =>
    isWebsiteItemVisible(status, copy)
  );
  const proFeatures = copy.pricing.proFeatures.filter(({ status }) =>
    isWebsiteItemVisible(status, copy)
  );

  return (
    <section
      id="pricing"
      className="border-b border-[#d6d8cf] bg-[#eeede8] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <SectionEyebrow text={copy.pricing.eyebrow} color="amber" />
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#29352e] sm:text-5xl">
            {copy.pricing.title}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[#667085]">
            {copy.pricing.body}
          </p>
        </div>

        {pricing ? (
          <div className="mx-auto mt-12 flex w-fit items-center gap-3 rounded-full border border-[#e8eaed] bg-white p-1.5 shadow-sm">
            {(['monthly', 'yearly'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBilling(option)}
                aria-pressed={billing === option}
                className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00] ${
                  billing === option
                    ? 'bg-[#344a3b] text-white shadow-sm'
                    : 'text-[#667085] hover:text-[#16181d]'
                }`}
              >
                {option === 'monthly' ? copy.pricing.monthly : copy.pricing.yearly}
                {option === 'yearly' ? (
                  <span
                    className={`ml-2 inline-flex items-center text-[10px] uppercase tracking-[0.08em] ${
                      billing === 'yearly' ? 'text-[#ffefbe]' : 'text-[#946200]'
                    }`}
                  >
                    <Zap className="mr-1 h-3 w-3 text-[#78906f]" aria-hidden="true" />
                    {copy.pricing.bestValue}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : isLoading ? (
          <div
            className="mx-auto mt-12 h-[52px] w-64 animate-pulse rounded-full bg-[#e8eaed]"
            aria-hidden="true"
          />
        ) : null}

        <div
          className={`mx-auto grid max-w-4xl gap-6 md:grid-cols-2 ${
            pricing || isLoading ? 'mt-8' : 'mt-12'
          }`}
        >
          <article className="flex flex-col rounded-[18px] border border-[rgba(113,126,105,.22)] bg-[rgba(249,249,245,.78)] p-7 text-[#29352e] shadow-[0_18px_48px_rgba(55,66,48,.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.13em] text-[#29352e]">
              {copy.pricing.freeName}
            </p>
            <div className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-[#16181d]">$0</div>
            <p className="mt-3 text-[#29352e]">{copy.pricing.freeSummary}</p>
            <ul className="mt-8 flex-1 space-y-4 text-sm text-[#344054]">
              {freeFeatures.map((feature) => (
                <li key={feature.title} className="flex gap-3 text-[#29352e]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#78906f]" aria-hidden="true" />
                  <span>{feature.title}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="relative flex flex-col overflow-hidden rounded-[18px] border border-[#344a3b] bg-[#344a3b] p-7 text-white shadow-[0_22px_60px_rgba(47,65,52,.18)]">
            <div className="absolute right-0 top-0 h-40 w-40 translate-x-12 -translate-y-12 rounded-full bg-[#f59e0b]/20 blur-2xl" />
            <div className="relative flex items-center gap-2">
              <Crown className="h-4 w-4 text-[#dce6d5]" aria-hidden="true" />
              <p className="text-sm font-semibold uppercase tracking-[0.13em] text-[#eaecf0]">
                {copy.pricing.proName}
              </p>
            </div>
            <div className="relative mt-4 min-h-12">
              {isLoading ? (
                <div
                  className="h-10 w-32 animate-pulse rounded-lg bg-white/10"
                  aria-label="Loading price"
                />
              ) : formattedPrice ? (
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-4xl font-semibold tracking-[-0.04em]">
                    {formattedPrice}
                  </span>
                  <span className="pb-1 text-sm text-[#d0d5dd]">
                    {billing === 'yearly' ? copy.pricing.perYear : copy.pricing.perMonth}
                  </span>
                </div>
              ) : (
                <p className="max-w-xs text-sm leading-6 text-[#d0d5dd]">
                  {copy.pricing.priceUnavailable}
                </p>
              )}
            </div>
            <p className="relative mt-4 text-[#d0d5dd]">{copy.pricing.proSummary}</p>
            <ul className="relative mt-8 flex-1 space-y-4 text-sm text-[#f9fafb]">
              {proFeatures.map((feature) => (
                <li key={feature.title} className="flex gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#dce6d5]" aria-hidden="true" />
                  <span>{feature.title}</span>
                </li>
              ))}
            </ul>
            <a
              href={CHROME_WEB_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="relative mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-5 font-semibold text-[#16181d] transition hover:-translate-y-0.5 hover:bg-[#fff8e7] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#181b21]"
            >
              <Image
                className="mr-2 h-4 w-4"
                src={`${ASSET_PREFIX}/assets/chrome.svg`}
                width={16}
                height={16}
                alt=""
              />
              {formattedPrice ? copy.ctas.primary : copy.pricing.viewPrice}
            </a>
            <p className="relative mt-3 text-center text-xs leading-5 text-[#98a2b3]">
              {copy.pricing.upgradeNote}
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
