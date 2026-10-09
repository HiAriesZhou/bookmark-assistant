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
    <section id="faq" className="editorial-faq bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <SectionEyebrow text={copy.faq.eyebrow} color="amber" />
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#16181d] sm:text-5xl">
            {copy.faq.title}
          </h2>
        </div>
        <Accordion className="mt-12 overflow-hidden rounded-[1.5rem] border border-[#e8eaed] bg-[#f6f7f9] px-6 sm:px-8">
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
