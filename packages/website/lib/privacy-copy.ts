import type { WebsiteLocale } from '@/lib/i18n';
import { PRODUCT_NAME, COMMERCE_ENABLED } from '@/lib/product-links';

type PrivacySection = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

export function getPrivacyCopy(locale: WebsiteLocale): PrivacyCopy {
  const copy = JSON.parse(JSON.stringify(privacyCopy[locale])) as PrivacyCopy;
  const brand = (text: string) => text.replace(/Bookmark Assistant/g, () => PRODUCT_NAME);
  copy.title = brand(copy.title);
  copy.description = brand(copy.description);
  copy.summary = brand(copy.summary);
  copy.backHome = brand(copy.backHome);
  copy.sections = copy.sections.map((section) => ({
    ...section,
    title: brand(section.title),
    paragraphs: section.paragraphs.map(brand),
    bullets: section.bullets?.map(brand),
  }));
  if (!COMMERCE_ENABLED) {
    const zh = locale === 'zh-CN';
    copy.summary = zh
      ? '本地书签管理可独立使用。连接 Notion 或运行 AI 时，数据由你选择的自托管服务与提供商处理。'
      : 'Local bookmark management works independently. Notion and AI data is handled by your selected self-hosted server and providers.';
    copy.sections = [
      {
        id: 'deployment',
        title: zh ? '自托管服务与数据' : 'Self-hosted service and data',
        paragraphs: [
          zh
            ? '这份说明是部署模板。运营者负责自己的隐私政策、数据库、备份和凭据保护；本部署关闭支付。'
            : 'This is a deployment template. The operator is responsible for their own privacy policy, database, backups and credentials. Payments are disabled for this deployment.',
          zh
            ? 'AI Provider Key 使用应用层加密；Notion Token 当前存储于数据库字段，需要保护数据库、卷与备份。'
            : 'AI provider keys use application-level encryption. Notion tokens currently reside in database fields; protect the database, storage volumes and backups.',
        ],
      },
      ...copy.sections
        .filter((section) => !['scope', 'billing'].includes(section.id))
        .map((section) => ({
          ...section,
          paragraphs: section.paragraphs.filter((paragraph) => !paragraph.includes('Paddle')),
        }))
        .filter((section) => section.paragraphs.length),
    ];
  }
  return copy;
}

export type PrivacyCopy = {
  title: string;
  description: string;
  eyebrow: string;
  summary: string;
  effectiveLabel: string;
  updatedLabel: string;
  date: string;
  contentsLabel: string;
  backHome: string;
  language: string;
  sections: readonly PrivacySection[];
};

export const privacyCopy: Record<WebsiteLocale, PrivacyCopy> = {
  en: {
    title: 'Privacy Policy · Bookmark Assistant',
    description:
      'How Bookmark Assistant handles browser, Notion, optional AI, billing, and diagnostic data.',
    eyebrow: 'Privacy, in plain language',
    summary:
      'Bookmark Assistant processes only the information needed for local bookmark management and library reports, Notion sync, optional AI features, billing, and support.',
    effectiveLabel: 'Effective',
    updatedLabel: 'Last updated',
    date: 'August 25, 2026',
    contentsLabel: 'On this page',
    backHome: 'Back to Bookmark Assistant',
    language: '中文',
    sections: [
      {
        id: 'scope',
        title: '1. Scope and service provider',
        paragraphs: [
          'This policy applies to the Bookmark Assistant Chrome extension, bookmarkassistant.com, and the managed services used to connect Chrome, Notion, Paddle, and an AI provider you choose.',
          'Questions or privacy requests can be sent to aries0331.dev@gmail.com.',
        ],
      },
      {
        id: 'local-report',
        title: '2. Local Bookmark Library Report',
        paragraphs: [
          'The Bookmark Library Report calculates bookmark and Reading List counts, duplicate groups, folder summaries, and uncategorized items inside the extension. Your full bookmark library is not uploaded to create this report.',
        ],
      },
      {
        id: 'notion-sync',
        title: '3. Notion connection and sync data',
        paragraphs: [
          'When you connect or sync, Bookmark Assistant processes the information required to perform the action you requested.',
        ],
        bullets: [
          'Account information, including the email and identifiers returned through the Notion OAuth flow.',
          'Notion OAuth tokens, workspace identifiers, selected database or data-source identifiers, and template connection settings. These are retained until you disconnect or the account is deleted.',
          'Bookmark, Reading List, and current-page fields selected for sync, such as title, URL, folder, source type, reading status, description, tags, and favicon when available.',
          'Notion page identifiers and stable item identifiers required to update entries and avoid duplicates.',
        ],
      },
      {
        id: 'metadata-cache',
        title: '4. Page metadata cache',
        paragraphs: [
          'To reduce repeated public-page requests, Bookmark Assistant may cache a normalized page URL and an extracted description for up to 30 days. Expired records are no longer used and are removed by periodic or request-triggered cleanup. Actual removal may occur after the expiry time when service traffic is low.',
        ],
      },
      {
        id: 'ai',
        title: '5. Optional AI summaries and tags',
        paragraphs: [
          'AI processing is optional. When you enable it for an eligible page, the request passes through Bookmark Assistant to the supported AI provider you selected.',
        ],
        bullets: [
          'The request may contain readable page text, title, a sanitized URL without credentials, query parameters, or fragments, the current Description and Tags, and a bounded set of relevant Notion tag candidates.',
          'It does not include your email, subscription status, Notion workspace or page identifiers, other bookmarks, browsing history, internal task identifiers, or the complete API key.',
          'Full page text, the complete prompt, raw provider responses, and the complete API key are not persisted by Bookmark Assistant after processing.',
          'One provider key is stored for your account using application-level AES-256-GCM encryption. The complete key is not returned after it is saved.',
          'You can exclude hostnames from AI processing. The extension checks the exclusion before upload and the service checks it again.',
        ],
      },
      {
        id: 'retention',
        title: '6. AI tasks, diagnostics, and retention',
        paragraphs: [
          'AI task and idempotency records are retained with your account so the same item is not repeatedly processed and interrupted work can be classified safely.',
          'Minimal diagnostics may include provider, model, request identifier, token counts, duration, retry count, and a standardized error code. They do not contain page text, title, URL, generated summary or tags, the complete key, or a raw provider response. Diagnostic records expire after 30 days and are removed by scheduled or request-triggered cleanup; low traffic may delay physical deletion.',
        ],
      },
      {
        id: 'billing',
        title: '7. Billing and subscriptions',
        paragraphs: [
          'Paddle processes checkout and payment information under its own privacy policy. Bookmark Assistant stores only the subscription, customer, plan, and entitlement identifiers needed to show and enforce your plan. Bookmark Assistant does not store complete payment-card details.',
        ],
      },
      {
        id: 'telemetry',
        title: '8. Reliability and support data',
        paragraphs: [
          'Bookmark Assistant may process minimal operational events and safe error categories to diagnose failures and provide support. Extension error reports and service logs are designed not to include bookmark titles, page content, complete URLs, complete API keys, raw provider responses, or raw client stack traces.',
          'The website does not add advertising trackers or a separate analytics product in this release.',
        ],
      },
      {
        id: 'sharing',
        title: '9. Service providers and data use',
        paragraphs: [
          'Information is shared only as needed to provide the action you requested: with Notion for authorized sync, with your selected AI provider for optional generation, with Paddle for billing, and with infrastructure providers that host Bookmark Assistant.',
          'We do not sell personal data, use it for advertising, or use it for creditworthiness or lending decisions. Each third-party service processes information under its own terms and privacy policy.',
        ],
      },
      {
        id: 'controls',
        title: '10. Your controls and deletion',
        paragraphs: [
          'You can disable AI, edit the excluded-hostname list, replace or delete the stored AI key, turn off scheduled sync, and disconnect Notion from the extension.',
          'Disconnecting deletes the Bookmark Assistant service account and its associated Notion connection and AI records. It does not delete pages already written to your Notion workspace. Paddle may retain billing records under its legal obligations; manage an active monthly subscription through the Paddle customer portal before disconnecting. Shared page-description cache entries expire under the retention rule above.',
        ],
      },
      {
        id: 'security',
        title: '11. Security and international processing',
        paragraphs: [
          'Bookmark Assistant uses HTTPS in transit, access controls, input minimization, fixed provider endpoints, and application-level encryption for stored AI credentials. No internet service can guarantee absolute security.',
          'Notion, Paddle, your selected AI provider, and hosting infrastructure may process information in countries other than your own, subject to their terms and safeguards.',
        ],
      },
      {
        id: 'limited-use',
        title: '12. Chrome Web Store Limited Use',
        paragraphs: [
          'Bookmark Assistant’s use and transfer of information received from Google APIs complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Browser data is used only to provide or improve the user-facing features described in this policy, and not for personalized advertising, unrelated profiling, credit decisions, or sale to data brokers.',
        ],
      },
      {
        id: 'changes',
        title: '13. Changes to this policy',
        paragraphs: [
          'We may update this policy when product behavior or legal requirements change. The updated date on this page identifies the current version. Material changes will be reflected here before the affected behavior is released.',
        ],
      },
    ],
  },
  'zh-CN': {
    title: '隐私政策 · Bookmark Assistant',
    description: 'Bookmark Assistant 如何处理浏览器、Notion、可选 AI、支付与诊断数据。',
    eyebrow: '用清楚的语言说明隐私',
    summary:
      'Bookmark Assistant 只处理本地书签管理与报告、Notion 同步、可选 AI、支付和支持所必需的信息。',
    effectiveLabel: '生效日期',
    updatedLabel: '最后更新',
    date: '2026 年 8 月 25 日',
    contentsLabel: '本页目录',
    backHome: '返回 Bookmark Assistant',
    language: 'English',
    sections: [
      {
        id: 'scope',
        title: '1. 适用范围与服务提供者',
        paragraphs: [
          '本政策适用于 Bookmark Assistant Chrome 扩展、bookmarkassistant.com，以及用于连接 Chrome、Notion、Paddle 和你所选 AI 服务商的托管服务。',
          '如有隐私问题或请求，请联系 aries0331.dev@gmail.com。',
        ],
      },
      {
        id: 'local-report',
        title: '2. 本地 Bookmark Library Report',
        paragraphs: [
          'Bookmark Library Report 会在扩展内计算书签与阅读清单数量、重复链接组、目录概况和未分类项目。生成此报告时不会上传你的完整书签库。',
        ],
      },
      {
        id: 'notion-sync',
        title: '3. Notion 连接与同步数据',
        paragraphs: ['连接或同步时，Bookmark Assistant 会处理完成你所请求操作必需的信息。'],
        bullets: [
          '账户信息，包括 Notion OAuth 流程返回的邮箱与标识符。',
          'Notion OAuth Token、工作区标识、所选数据库或数据源标识，以及模板连接设置。这些信息保留到你断开连接或账户被删除。',
          '你选择同步的书签、阅读清单和当前页面字段，例如标题、URL、目录、来源类型、阅读状态、描述、标签，以及可用时的网站图标。',
          '更新条目和避免重复所需的 Notion 页面标识与稳定项目标识。',
        ],
      },
      {
        id: 'metadata-cache',
        title: '4. 页面元数据缓存',
        paragraphs: [
          '为了减少重复请求公开页面，Bookmark Assistant 可能缓存规范化页面 URL 和提取出的描述，最长有效期为 30 天。过期记录不再使用，并由定期或请求触发的清理删除。服务流量较低时，实际删除可能晚于过期时间。',
        ],
      },
      {
        id: 'ai',
        title: '5. 可选 AI 摘要与标签',
        paragraphs: [
          'AI 处理是可选功能。为符合条件的页面启用后，请求会经 Bookmark Assistant 发送到你选择的受支持 AI 服务商。',
        ],
        bullets: [
          '请求可能包含可读页面正文、标题、移除凭据、查询参数和 Fragment 后的净化 URL、当前 Description 与 Tags，以及数量受限的相关 Notion 标签候选。',
          '请求不包含你的邮箱、订阅状态、Notion 工作区或页面标识、其他书签、浏览历史、内部任务标识或完整 API Key。',
          'Bookmark Assistant 不会在处理后持久化完整页面正文、完整 Prompt、原始服务商响应或完整 API Key。',
          '账户可保存一个使用应用层 AES-256-GCM 加密的服务商 Key；保存后不会再次返回完整 Key。',
          '你可以排除不参与 AI 处理的 hostname。扩展会在上传前检查，服务端会再次检查。',
        ],
      },
      {
        id: 'retention',
        title: '6. AI 任务、诊断与保留期限',
        paragraphs: [
          'AI 任务与幂等记录会随账户保留，以避免同一项目被反复处理，并安全判断中断任务的状态。',
          '最小诊断数据可能包括服务商、模型、请求标识、Token 数、耗时、重试次数和标准错误码；不包含页面正文、标题、URL、生成的摘要或标签、完整 Key 或原始服务商响应。诊断记录 30 天后过期，并由定时或请求触发的清理删除；低流量可能延迟物理删除。',
        ],
      },
      {
        id: 'billing',
        title: '7. 支付与订阅',
        paragraphs: [
          'Paddle 会依据其隐私政策处理结账与支付信息。Bookmark Assistant 只保存显示和执行套餐权益所需的订阅、客户、计划和权益标识，不保存完整银行卡信息。',
        ],
      },
      {
        id: 'telemetry',
        title: '8. 稳定性与支持数据',
        paragraphs: [
          'Bookmark Assistant 可能处理最少量的运行事件和安全错误分类，用于诊断故障与提供支持。扩展错误上报和服务端日志不会记录书签标题、页面正文、完整 URL、完整 API Key、原始服务商响应或原始客户端堆栈。',
          '本次发布不会在官网新增广告追踪器或独立分析产品。',
        ],
      },
      {
        id: 'sharing',
        title: '9. 服务提供商与数据用途',
        paragraphs: [
          '信息只会在提供你所请求操作所必需的范围内共享：授权同步使用 Notion、可选生成使用你选择的 AI 服务商、支付使用 Paddle，以及由基础设施提供商托管 Bookmark Assistant。',
          '我们不出售个人数据，不将其用于广告，也不用于信用评估或借贷决定。各第三方服务依据其自身条款和隐私政策处理信息。',
        ],
      },
      {
        id: 'controls',
        title: '10. 你的控制与删除方式',
        paragraphs: [
          '你可以关闭 AI、编辑排除 hostname 列表、更换或删除已保存的 AI Key、关闭定时同步，并从扩展中断开 Notion。',
          '断开连接会删除 Bookmark Assistant 服务账户及其关联的 Notion 连接和 AI 记录，但不会删除已经写入 Notion 工作区的页面。Paddle 可能因法律义务保留支付记录；如有有效月度订阅，请先通过 Paddle 客户门户管理订阅。共享页面描述缓存会按上述保留规则过期。',
        ],
      },
      {
        id: 'security',
        title: '11. 安全与跨境处理',
        paragraphs: [
          'Bookmark Assistant 使用 HTTPS 传输、访问控制、输入最小化、固定服务商端点，并对保存的 AI 凭据进行应用层加密。任何互联网服务都无法保证绝对安全。',
          'Notion、Paddle、你选择的 AI 服务商和托管基础设施可能在你所在国家或地区以外处理信息，并受其条款与保护措施约束。',
        ],
      },
      {
        id: 'limited-use',
        title: '12. Chrome Web Store Limited Use',
        paragraphs: [
          'Bookmark Assistant 对从 Google API 获得的信息的使用和传输遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。浏览器数据仅用于提供或改进本政策所述的用户可见功能，不用于个性化广告、无关画像、信用决定，也不会出售给数据经纪商。',
        ],
      },
      {
        id: 'changes',
        title: '13. 政策变更',
        paragraphs: [
          '当产品行为或法律要求变化时，我们可能更新本政策。本页的最后更新日期代表当前版本；重大变更会在相关行为发布前反映在这里。',
        ],
      },
    ],
  },
};
