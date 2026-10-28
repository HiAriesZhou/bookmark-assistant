import { z } from 'zod';

const claimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const publicationStatusSchema = z.enum(['released', 'prepared']);
const websiteItemSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  status: publicationStatusSchema.default('released'),
});

const websiteSchema = z.object({
  publication: z.object({
    ai: publicationStatusSchema,
  }),
  capabilities: z.record(z.string().min(1), publicationStatusSchema),
  metadata: z.object({
    baselineTitle: z.string().min(1),
    baselineDescription: z.string().min(1).max(180),
    aiTitle: z.string().min(1),
    aiDescription: z.string().min(1).max(180),
  }),
  navigation: z.object({
    features: z.string().min(1),
    howItWorks: z.string().min(1),
    faq: z.string().min(1),
    language: z.string().min(1),
  }),
  hero: z.object({
    baselineEyebrow: z.string().min(1),
    baselineTitle: z.string().min(1),
    baselineBody: z.string().min(1),
    aiEyebrow: z.string().min(1),
    aiTitle: z.string().min(1),
    aiBody: z.string().min(1),
    benefitsLabel: z.string().min(1),
    baselineBenefits: z.array(z.string().min(1)).min(1),
    aiBenefits: z.array(z.string().min(1)).min(1),
    imageAlt: z.string().min(1),
    imageNote: z.string().min(1),
    productHunt: z.string().min(1),
    productHuntCta: z.string().min(1),
  }),
  features: z.object({
    eyebrow: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    items: z.array(websiteItemSchema).min(1),
  }),
  ai: z.object({
    eyebrow: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    points: z.array(z.string().min(1)).min(1),
    screenshotAlt: z.string().min(1),
  }),
  how: z.object({
    eyebrow: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    steps: z.array(websiteItemSchema).min(1),
  }),
  faq: z.object({
    eyebrow: z.string().min(1),
    title: z.string().min(1),
    items: z.array(websiteItemSchema).min(1),
  }),
  finalCta: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  footer: z.object({
    summary: z.string().min(1),
    product: z.string().min(1),
    resources: z.string().min(1),
    legal: z.string().min(1),
    notionGuide: z.string().min(1),
    chromeStore: z.string().min(1),
    support: z.string().min(1),
    privacy: z.string().min(1),
    terms: z.string().min(1),
  }),
});

export const marketingContentSchema = z.object({
  locale: z.enum(['en', 'zh-CN']),
  productName: z.string().trim().min(1).max(80),
  extensionName: z.string().min(1).max(75),
  extensionTitle: z.string().min(1).max(45),
  shortDescription: z.string().min(1).max(132),
  longDescription: z.string().min(80).max(16_000),
  releasedClaims: z.array(claimSchema).min(1),
  featureGatedClaims: z.array(claimSchema.extend({ gate: z.string().min(1) })),
  ctas: z.object({ primary: z.string().min(1), secondary: z.string().min(1) }),
  store: z.object({
    marquee: z.object({
      headline: z.string().min(1).max(80),
      body: z.string().min(1).max(180),
      meta: z.string().min(1).max(100),
      productHunt: z.string().min(1).max(100),
    }),
  }),
  screenshots: z.array(
    z.object({
      id: z.string().min(1),
      headline: z.string().min(1).max(80),
      body: z.string().min(1).max(180),
      status: z.enum(['released', 'feature-gated']),
      gate: z.string().min(1).optional(),
    })
  ),
  website: websiteSchema,
});

export const policySchema = z.object({
  runtimeLocales: z.array(z.string()).length(2),
  marketingLocales: z.array(z.string()).length(2),
  extensionLocaleMap: z.record(z.string(), z.string()),
  requiredScreenshotIds: z.array(z.string()).length(5),
  forbiddenPublicClaimPatterns: z.array(z.string()).min(1),
});
