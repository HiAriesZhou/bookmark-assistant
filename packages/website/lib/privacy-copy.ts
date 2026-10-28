import type { WebsiteLocale } from '@/lib/i18n';
import { PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/product-links';

type PrivacySection = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

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

function contactParagraph(locale: WebsiteLocale): string {
  if (locale === 'zh-CN') {
    return SUPPORT_EMAIL
      ? `如有隐私问题或请求，请联系 ${SUPPORT_EMAIL}。`
      : '如有隐私问题或请求，请联系发布此版本的维护者。';
  }
  return SUPPORT_EMAIL
    ? `Questions or privacy requests can be sent to ${SUPPORT_EMAIL}.`
    : 'Send questions or privacy requests to the maintainer who published this build.';
}

export function getPrivacyCopy(locale: WebsiteLocale): PrivacyCopy {
  const source = privacyCopy[locale];
  const brand = (text: string) => text.replace(/Bookmark Assistant/g, () => PRODUCT_NAME);
  return {
    ...source,
    title: brand(source.title),
    description: brand(source.description),
    summary: brand(source.summary),
    backHome: brand(source.backHome),
    sections: source.sections.map((section) => ({
      ...section,
      title: brand(section.title),
      paragraphs: (section.id === 'scope'
        ? [...section.paragraphs, contactParagraph(locale)]
        : section.paragraphs
      ).map(brand),
      bullets: section.bullets?.map(brand),
    })),
  };
}

const privacyCopy: Record<WebsiteLocale, PrivacyCopy> = {
  en: {
    title: 'Privacy Policy · Bookmark Assistant',
    description:
      'How the Bookmark Assistant extension handles your bookmarks, your Notion token and your optional AI provider key.',
    eyebrow: 'Privacy, in plain language',
    summary:
      'Bookmark Assistant runs in your browser and has no service of its own. Your data stays on your device unless you connect Notion or an AI provider, and then it goes directly to the service you chose.',
    effectiveLabel: 'Effective',
    updatedLabel: 'Last updated',
    date: 'October 28, 2026',
    contentsLabel: 'On this page',
    backHome: 'Back to Bookmark Assistant',
    language: '中文',
    sections: [
      {
        id: 'scope',
        title: '1. Scope',
        paragraphs: [
          'This policy applies to the Bookmark Assistant Chrome extension and this website. The extension is free and open source. It does not send your data to Bookmark Assistant, and there is nothing to register.',
        ],
      },
      {
        id: 'local-library',
        title: '2. Local library and storage',
        paragraphs: [
          'The extension reads and edits your Chrome bookmarks and reads your Reading List through Chrome’s own APIs. Chrome bookmarks remain the source of truth.',
          'Library counts, duplicate groups, folder summaries and uncategorized items are calculated inside the extension. Your bookmark library is not uploaded to create them.',
          'Preferences, descriptions and tags you add, cached reports, sync state, your Notion token and your AI provider key are kept in the extension’s local storage on your device. They are not stored in Chrome sync storage.',
        ],
      },
      {
        id: 'notion',
        title: '3. Optional Notion sync',
        paragraphs: [
          'Notion is optional. When you paste a Notion personal access token or internal integration token, the extension uses it to call the Notion API directly. The token is sent only to Notion.',
        ],
        bullets: [
          'When you sync, save a page or let the extension create a database, it sends the fields needed for that action: title, URL, folder, source, reading status, description, tags, date added and a stable sync identifier.',
          'Each Notion page icon is set to a Google favicon address for the link’s domain, which Notion loads to display the icon.',
          'The selected database and the Notion page identifiers needed to update entries are stored locally.',
          'Scheduled background sync runs only if you turn it on.',
        ],
      },
      {
        id: 'current-page',
        title: '4. Saving the current page',
        paragraphs: [
          'When you choose Save current page in the popup or the right-click menu, the extension reads that tab’s title, URL and meta description and sends them to your Notion database. It does not read the page body and does not monitor your browsing.',
        ],
      },
      {
        id: 'ai',
        title: '5. Optional AI organize',
        paragraphs: [
          'AI is optional. When you add your own key and ask for folder suggestions, the extension sends a request directly to the provider you chose. It does not pass through Bookmark Assistant.',
        ],
        bullets: [
          'A request contains only bookmark titles, folder paths and URLs without query strings for the bookmarks in the current view.',
          'Common local and private-network addresses and non-web addresses are not sent.',
          'Chrome asks for access to a provider’s host when you save a key for it, and that access is released when you remove or replace the key.',
          'The key is stored only on this device and is not encrypted. The information needed to undo the last run is also stored locally.',
        ],
      },
      {
        id: 'website',
        title: '6. Website, diagnostics and analytics',
        paragraphs: [
          'The extension does not send error reports, usage analytics or advertising data. The website does not use advertising trackers or an analytics product. The home page loads a badge image from Product Hunt.',
        ],
      },
      {
        id: 'sharing',
        title: '7. Third parties and data use',
        paragraphs: [
          'Data leaves your device only for the actions you request: to Notion when you connect and sync, and to your selected AI provider when you ask for folder suggestions. Each service processes that data under its own terms and privacy policy.',
          'Bookmark Assistant does not sell personal data, use it for advertising, or use it for creditworthiness or lending decisions.',
        ],
      },
      {
        id: 'controls',
        title: '8. Your controls and deletion',
        paragraphs: [
          'You can disconnect Notion, remove or replace your AI key and turn off scheduled sync in Options. Removing the extension deletes its local storage. None of these actions deletes Chrome bookmarks or pages already written to your Notion workspace.',
        ],
      },
      {
        id: 'security',
        title: '9. Security',
        paragraphs: [
          'Requests to Notion and AI providers use HTTPS. Data in the extension’s local storage is not available to websites or other extensions, but anyone with access to your Chrome profile may be able to read it. No software can guarantee absolute security.',
        ],
      },
      {
        id: 'older-versions',
        title: '10. Older versions',
        paragraphs: [
          'Extension versions released before this one used a hosted service with sign-in for Notion sync and AI. That service is being retired and serves only those older versions; the current version does not contact it. To ask for deletion of data held there, use the contact address above.',
        ],
      },
      {
        id: 'limited-use',
        title: '11. Chrome Web Store Limited Use',
        paragraphs: [
          'Bookmark Assistant’s use and transfer of information received from Google APIs complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Browser data is used only to provide or improve the user-facing features described in this policy, and not for personalized advertising, unrelated profiling, credit decisions, or sale to data brokers.',
        ],
      },
      {
        id: 'changes',
        title: '12. Changes to this policy',
        paragraphs: [
          'We may update this policy when product behavior or legal requirements change. The updated date on this page identifies the current version. Material changes will be reflected here before the affected behavior is released.',
        ],
      },
    ],
  },
  'zh-CN': {
    title: '隐私政策 · Bookmark Assistant',
    description: 'Bookmark Assistant 扩展如何处理你的书签、Notion 令牌和可选的 AI 服务商 key。',
    eyebrow: '用清楚的语言说明隐私',
    summary:
      'Bookmark Assistant 在浏览器中运行，没有自己的服务端。除非你连接 Notion 或 AI 服务商，数据都只留在你的设备上；连接后，数据也只会直接发送给你选择的服务。',
    effectiveLabel: '生效日期',
    updatedLabel: '最后更新',
    date: '2026 年 10 月 28 日',
    contentsLabel: '本页目录',
    backHome: '返回 Bookmark Assistant',
    language: 'English',
    sections: [
      {
        id: 'scope',
        title: '1. 适用范围',
        paragraphs: [
          '本政策适用于 Bookmark Assistant Chrome 扩展和本网站。扩展免费且开源，不会把你的数据发送给 Bookmark Assistant，也无需注册。',
        ],
      },
      {
        id: 'local-library',
        title: '2. 本地书签库与存储',
        paragraphs: [
          '扩展通过 Chrome 自带的接口读取和编辑书签、读取阅读清单。Chrome 书签始终是唯一的数据来源。',
          '书签数量、重复链接组、目录概况和未分类项目都在扩展内计算，不需要上传书签库。',
          '偏好设置、你添加的描述和标签、报告缓存、同步状态、Notion 令牌以及 AI 服务商 key 都保存在本机的扩展本地存储中，不会放进 Chrome 的同步存储。',
        ],
      },
      {
        id: 'notion',
        title: '3. 可选的 Notion 同步',
        paragraphs: [
          'Notion 完全可选。你粘贴 Notion 个人访问令牌或内部集成令牌后，扩展会用它直接调用 Notion API。令牌只会发送给 Notion。',
        ],
        bullets: [
          '同步、保存页面或让扩展新建数据库时，只发送完成该操作所需的字段：标题、网址、文件夹、来源、阅读状态、描述、标签、添加日期和稳定的同步标识。',
          '每个 Notion 页面的图标会设为该链接域名对应的 Google 网站图标地址，由 Notion 加载显示。',
          '所选数据库以及更新条目所需的 Notion 页面标识保存在本机。',
          '只有你开启后，才会在后台定时同步。',
        ],
      },
      {
        id: 'current-page',
        title: '4. 保存当前页面',
        paragraphs: [
          '在弹出窗口或右键菜单中选择保存当前页面时，扩展会读取该标签页的标题、网址和页面简介（meta description），并发送到你的 Notion 数据库。扩展不会读取页面正文，也不会监控你的浏览活动。',
        ],
      },
      {
        id: 'ai',
        title: '5. 可选的 AI 整理',
        paragraphs: [
          'AI 完全可选。你添加自己的 key 并请求文件夹建议时，扩展会把请求直接发送给你选择的服务商，不经过 Bookmark Assistant。',
        ],
        bullets: [
          '请求只包含当前视图中书签的标题、文件夹路径和去掉查询参数的网址。',
          '常见的本地和内网地址以及非网页地址不会被发送。',
          '保存某个服务商的 key 时，Chrome 才会请求访问该服务商的权限；移除或更换 key 后，该权限会被释放。',
          'Key 只保存在本机，未加密。撤销上一次整理所需的信息也保存在本机。',
        ],
      },
      {
        id: 'website',
        title: '6. 网站、诊断与统计',
        paragraphs: [
          '扩展不会发送错误报告、使用统计或广告数据。网站不使用广告追踪器或统计分析产品。首页会从 Product Hunt 加载一张徽章图片。',
        ],
      },
      {
        id: 'sharing',
        title: '7. 第三方与数据用途',
        paragraphs: [
          '只有在你请求相应操作时，数据才会离开你的设备：连接并同步时发送给 Notion，请求文件夹建议时发送给你选择的 AI 服务商。各服务依据其自身条款和隐私政策处理这些数据。',
          'Bookmark Assistant 不出售个人数据，不将其用于广告，也不用于信用评估或借贷决定。',
        ],
      },
      {
        id: 'controls',
        title: '8. 你的控制与删除方式',
        paragraphs: [
          '你可以在设置页断开 Notion、移除或更换 AI key、关闭定时同步。卸载扩展会删除它的本地存储。这些操作都不会删除 Chrome 书签，也不会删除已经写入 Notion 工作区的页面。',
        ],
      },
      {
        id: 'security',
        title: '9. 安全',
        paragraphs: [
          '发送给 Notion 和 AI 服务商的请求都使用 HTTPS。扩展本地存储中的数据不会被网站或其他扩展读取，但能访问你 Chrome 个人资料的人可能读取到。任何软件都无法保证绝对安全。',
        ],
      },
      {
        id: 'older-versions',
        title: '10. 旧版本',
        paragraphs: [
          '此前发布的扩展版本通过一个需要登录的托管服务完成 Notion 同步和 AI 功能。该服务正在停用，只为这些旧版本继续运行；当前版本不会访问它。如需删除其中保存的数据，请通过上方的联系方式提出。',
        ],
      },
      {
        id: 'limited-use',
        title: '11. Chrome Web Store Limited Use',
        paragraphs: [
          'Bookmark Assistant 对从 Google API 获得的信息的使用和传输遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。浏览器数据仅用于提供或改进本政策所述的用户可见功能，不用于个性化广告、无关画像、信用决定，也不会出售给数据经纪商。',
        ],
      },
      {
        id: 'changes',
        title: '12. 政策变更',
        paragraphs: [
          '当产品行为或法律要求变化时，我们可能更新本政策。本页的最后更新日期代表当前版本；重大变更会在相关行为发布前反映在这里。',
        ],
      },
    ],
  },
};
