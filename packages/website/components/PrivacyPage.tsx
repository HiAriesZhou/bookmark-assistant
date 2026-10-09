import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Logo } from '@/components/icons/Logo';
import { PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/product-links';
import { alternateLocale, localePath, type WebsiteLocale } from '@/lib/i18n';
import { getPrivacyCopy } from '@/lib/privacy-copy';

export function PrivacyPage({ locale }: { locale: WebsiteLocale }) {
  const copy = getPrivacyCopy(locale);
  const otherLocale = alternateLocale(locale);

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-[#16181d]">
      <header className="border-b border-[#e8eaed] bg-white/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a
            href={localePath(locale, 'home')}
            className="flex items-center gap-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00]"
          >
            <Logo className="h-10 w-10" />
            <span>{PRODUCT_NAME}</span>
          </a>
          <a
            href={localePath(otherLocale, 'privacy')}
            hrefLang={otherLocale}
            className="inline-flex min-h-10 items-center rounded-lg border border-[#e8eaed] bg-white px-4 text-sm font-semibold text-[#946200] transition hover:border-[#eed9a2] hover:bg-[#fff8e7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00]"
          >
            {copy.language}
          </a>
        </div>
      </header>

      <section className="border-b border-[#e8eaed] bg-[radial-gradient(circle_at_80%_20%,rgba(245,158,11,0.18),transparent_28%),#f6f7f9]">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
          <a
            href={localePath(locale, 'home')}
            className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#946200] hover:text-[#16181d]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {copy.backHome}
          </a>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#946200]">
            {copy.eyebrow}
          </p>
          <h1 className="mt-4 max-w-4xl text-5xl font-semibold tracking-[-0.055em] sm:text-7xl">
            {copy.title.split(' · ')[0]}
          </h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-[#344054] sm:text-xl">
            {copy.summary}
          </p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-[#667085]">
            <span>
              {copy.effectiveLabel}: {copy.date}
            </span>
            <span>
              {copy.updatedLabel}: {copy.date}
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[240px_minmax(0,760px)] lg:justify-center">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#667085]">
            {copy.contentsLabel}
          </p>
          <nav aria-label={copy.contentsLabel}>
            <ol className="space-y-2 text-sm text-[#667085]">
              {copy.sections.map((section) => (
                <li key={section.id}>
                  <a className="block py-1 hover:text-[#16181d]" href={`#${section.id}`}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="min-w-0 rounded-[2rem] border border-[#e8eaed] bg-white px-6 py-4 shadow-[0_24px_70px_rgba(24,27,33,0.08)] sm:px-10">
          {copy.sections.map((section) => (
            <section
              id={section.id}
              key={section.id}
              className="scroll-mt-8 border-b border-[#e8eaed] py-9 last:border-0"
            >
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-[#16181d]">
                {section.title}
              </h2>
              <div className="mt-4 space-y-4 text-[1.03rem] leading-8 text-[#344054]">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul className="list-disc space-y-3 pl-5 marker:text-[#946200]">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ))}
          <a
            href={SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : localePath(locale, 'home')}
            className="mb-8 mt-4 inline-flex items-center gap-2 font-semibold text-[#946200] underline decoration-[#eed9a2] underline-offset-4"
          >
            {SUPPORT_EMAIL || PRODUCT_NAME}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </article>
      </div>
    </main>
  );
}
