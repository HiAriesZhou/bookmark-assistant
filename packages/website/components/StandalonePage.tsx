import type { ReactNode } from 'react';

/** Shared frame for single-purpose pages such as checkout, sign-in help and payment success. */
export function StandalonePage({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#ffefbe,transparent_45%),#f6f7f9] px-6 py-16">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#e8eaed] bg-white p-8 text-center shadow-[0_30px_90px_rgba(24,27,33,0.13)] sm:p-12">
        <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#181b21] text-white shadow-lg">
          {icon}
        </div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#946200]">
          {eyebrow}
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-[#16181d]">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export const STANDALONE_BODY = 'mx-auto mt-5 max-w-md text-lg leading-8 text-[#667085]';
export const STANDALONE_PRIMARY =
  'inline-flex min-h-12 items-center justify-center rounded-xl bg-[#181b21] px-6 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#292d35] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00] focus-visible:ring-offset-2';
export const STANDALONE_SECONDARY =
  'inline-flex min-h-12 items-center justify-center rounded-xl border border-[#e8eaed] px-6 font-semibold text-[#16181d] transition hover:border-[#16181d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a36d00] focus-visible:ring-offset-2';
