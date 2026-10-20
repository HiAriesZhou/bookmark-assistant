import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { isWebsiteItemVisible, type WebsiteCopy } from '@/lib/i18n';

export function FAQ({ copy }: { copy: WebsiteCopy }) {
  const items = copy.faq.items.filter(({ status }) => isWebsiteItemVisible(status, copy));
  return (
    <section id="faq" className="bg-[#f9f9f5] py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <SectionEyebrow text={copy.faq.eyebrow} color="amber" />
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#29352e] sm:text-5xl">
            {copy.faq.title}
          </h2>
        </div>
        <Accordion className="mt-12 overflow-hidden rounded-[16px] border border-[#dfe2d8] bg-[rgba(255,255,255,.54)] px-6 sm:px-8">
          {items.map((item) => (
            <AccordionItem key={item.title}>
              <AccordionTrigger>{item.title}</AccordionTrigger>
              <AccordionContent>{item.body}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
