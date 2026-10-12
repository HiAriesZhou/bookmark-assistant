/* Deterministic chrome.* mocks for Options and popup development previews. */
import enMessages from '../../_locales/en/messages.json';
import zhMessages from '../../_locales/zh_CN/messages.json';
import { PRODUCT_VERSION } from '../product-version.generated';
import {
  createDemoScenarios,
  parseDemoConfig,
  type DemoLocale,
  type DemoScenarioId,
} from './demo-scenarios';

const config = parseDemoConfig(window.location.search);
const frozenNow = Date.parse(config.frozenTime);
Date.now = () => frozenNow;
document.documentElement.lang = config.locale;
document.documentElement.dataset.demoScenario = config.scenarioId;
document.documentElement.dataset.demoLocale = config.locale;
document.documentElement.dataset.demoReady = 'true';

const catalogs: Record<DemoLocale, Record<string, { message: string }>> = {
  en: enMessages,
  'zh-CN': zhMessages,
};
const messages = catalogs[config.locale];
const scenarios = createDemoScenarios(frozenNow);
let activeScenarioId: DemoScenarioId = config.scenarioId;
const listeners: Array<(changes: Record<string, unknown>, areaName: string) => void> = [];

const day = 24 * 60 * 60 * 1_000;
const demoText = (english: string, chinese: string) =>
  config.locale === 'zh-CN' ? chinese : english;
const demoBookmarkTree = [
  {
    id: 'root',
    title: '',
    children: [
      {
        id: 'bar',
        parentId: 'root',
        title: demoText('Bookmarks Bar', '书签栏'),
        children: [
          {
            id: 'product',
            parentId: 'bar',
            title: demoText('Product', '产品'),
            children: [
              {
                id: 'demo-1',
                parentId: 'product',
                title: 'README? LandingPage',
                url: 'https://www.arieszhou.com/blog/readme-landingpage-guide',
                dateAdded: frozenNow - day,
              },
              {
                id: 'demo-2',
                parentId: 'product',
                title: demoText('Patterns for local-first products', '本地优先产品的设计模式'),
                url: 'https://product.example.test/local-first',
                dateAdded: frozenNow - 2 * day,
              },
              {
                id: 'design',
                parentId: 'product',
                title: demoText('Design', '设计'),
                children: [
                  {
                    id: 'demo-3',
                    parentId: 'design',
                    title: demoText(
                      'Designing interfaces that stay out of the way',
                      '不打扰用户的界面设计'
                    ),
                    url: 'https://design.example.test/calm-interfaces',
                    dateAdded: frozenNow - 3 * day,
                  },
                  {
                    id: 'demo-4',
                    parentId: 'design',
                    title: demoText(
                      'Typography for dense productivity tools',
                      '高密度工具的排版方法'
                    ),
                    url: 'https://design.example.test/typography',
                    dateAdded: frozenNow - 6 * day,
                  },
                ],
              },
            ],
          },
          {
            id: 'engineering',
            parentId: 'bar',
            title: demoText('Engineering', '工程'),
            children: [
              {
                id: 'demo-5',
                parentId: 'engineering',
                title: demoText('A practical guide to browser extensions', '浏览器扩展实践指南'),
                url: 'https://engineering.example.test/extensions',
                dateAdded: frozenNow - 4 * day,
              },
              {
                id: 'demo-6',
                parentId: 'engineering',
                title: demoText(
                  'Reliable background work in Manifest V3',
                  'Manifest V3 后台任务设计'
                ),
                url: 'https://engineering.example.test/mv3',
                dateAdded: frozenNow - 8 * day,
              },
            ],
          },
          {
            id: 'research',
            parentId: 'bar',
            title: demoText('Research', '研究'),
            children: [
              {
                id: 'demo-7',
                parentId: 'research',
                title: demoText('Information Anxiety and FOMO', '信息焦虑与 FOMO'),
                url: 'https://www.arieszhou.com/blog/information-anxiety-and-fomo',
                dateAdded: frozenNow - 5 * day,
              },
              {
                id: 'demo-8',
                parentId: 'research',
                title: demoText('AI Doesn’t Understand “That Earlier One”', 'AI 不理解“之前那个”'),
                url: 'https://www.arieszhou.com/blog/ai-doesnt-understand-that-earlier-one',
                dateAdded: frozenNow - 7 * day,
              },
            ],
          },
          {
            id: 'demo-9',
            parentId: 'bar',
            title: demoText(
              'A thoughtful guide to reading product research',
              '如何读懂一份产品研究'
            ),
            url: 'https://reading.example.test/product-research',
            dateAdded: frozenNow - 9 * day,
          },
        ],
      },
      {
        id: 'other',
        parentId: 'root',
        title: demoText('Other Bookmarks', '其他书签'),
        children: [
          {
            id: 'demo-10',
            parentId: 'other',
            title: demoText('Patterns for local-first products', '本地优先产品的设计模式'),
            url: 'https://product.example.test/local-first',
            dateAdded: frozenNow - 12 * day,
          },
        ],
      },
    ],
  },
];

const demoBookmarkMetadata = {
  schemaVersion: 1,
  byBookmarkId: {
    'demo-1': {
      description: demoText(
        'Show the result. Help readers get to their first try.',
        '先展示结果，再带读者完成第一次尝试。'
      ),
      tags:
        config.locale === 'zh-CN'
          ? ['产品设计', '开发者体验']
          : ['Product design', 'Developer experience'],
      updatedAt: new Date(frozenNow - day).toISOString(),
    },
    'demo-2': {
      description: demoText(
        'Practical patterns for software that keeps user data close and portable.',
        '让用户数据留在身边并保持可迁移的实用模式。'
      ),
      tags: config.locale === 'zh-CN' ? ['本地优先', '架构'] : ['local-first', 'architecture'],
      updatedAt: new Date(frozenNow - 2 * day).toISOString(),
    },
    'demo-3': {
      description: demoText(
        'Interaction details for interfaces that help without demanding attention.',
        '让界面提供帮助，却不过度争夺注意力。'
      ),
      tags: config.locale === 'zh-CN' ? ['设计', '体验'] : ['design', 'ux'],
      updatedAt: new Date(frozenNow - 3 * day).toISOString(),
    },
    'demo-4': {
      tags: config.locale === 'zh-CN' ? ['设计', '排版'] : ['design', 'typography'],
      updatedAt: new Date(frozenNow - 6 * day).toISOString(),
    },
    'demo-5': {
      tags: config.locale === 'zh-CN' ? ['工程', 'Chrome'] : ['engineering', 'chrome'],
      updatedAt: new Date(frozenNow - 4 * day).toISOString(),
    },
    'demo-6': {
      tags: config.locale === 'zh-CN' ? ['工程', '可靠性'] : ['engineering', 'reliability'],
      updatedAt: new Date(frozenNow - 8 * day).toISOString(),
    },
    'demo-7': {
      description: demoText(
        'Focus on the problems tools solve, rather than chasing every new release.',
        '关注工具解决的问题，而不是追赶每一次更新。'
      ),
      tags: config.locale === 'zh-CN' ? ['信息焦虑', '学习'] : ['FOMO', 'Learning'],
      updatedAt: new Date(frozenNow - 5 * day).toISOString(),
    },
    'demo-8': {
      description: demoText(
        'Preserve the decisions and tradeoffs behind a project so the next conversation can continue.',
        '保留项目决策与取舍，让下一次对话能够继续。'
      ),
      tags: config.locale === 'zh-CN' ? ['AI', '上下文'] : ['AI', 'Context'],
      updatedAt: new Date(frozenNow - 7 * day).toISOString(),
    },
  },
};

function activeScenario() {
  return scenarios[activeScenarioId];
}

function emitStorageChange(changes: Record<string, unknown>, areaName = 'local') {
  listeners.forEach((callback) => callback(changes, areaName));
}

const initialScenario = activeScenario();
const storageData: Record<string, unknown> = {
  session_token:
    initialScenario.dashboard.connection.status === 'disconnected' ? undefined : 'demo-session',
  notion_token:
    initialScenario.dashboard.connection.status === 'disconnected' ? undefined : 'demo-notion',
  last_sync: initialScenario.dashboard.sync.lastSyncAt,
  sync_in_progress: false,
  last_sync_error: undefined,
  is_pro: initialScenario.plan === 'pro',
  entitlements_cached_at: frozenNow,
  purchase_type: initialScenario.plan === 'pro' ? 'monthly' : undefined,
  subscription_source: initialScenario.plan === 'pro' ? 'paddle' : undefined,
  bookmark_library_metadata_v1: demoBookmarkMetadata,
};

function localize(key: string, substitutions?: string | string[]) {
  const message = messages[key]?.message || key;
  const values =
    substitutions === undefined
      ? []
      : Array.isArray(substitutions)
        ? substitutions
        : [substitutions];
  return message.replace(
    /\$(\d+)/g,
    (_match, index: string) => values[Number(index) - 1] ?? _match
  );
}

const chromeMock: any = {
  i18n: {
    getMessage: localize,
    getAcceptLanguages: async () => [config.locale],
    getUILanguage: () => config.locale,
    detectLanguage: (
      _details: { text: string },
      callback: (result: { languages: Array<{ language: string; percentage: number }> }) => void
    ) => callback({ languages: [{ language: config.locale, percentage: 100 }] }),
  },
  bookmarks: {
    async getTree() {
      return demoBookmarkTree;
    },
  },
  storage: {
    local: {
      async get(keys?: string[] | string | Record<string, unknown> | null) {
        if (!keys) return { ...storageData };
        const result: Record<string, unknown> = {};
        const requested = Array.isArray(keys)
          ? keys
          : typeof keys === 'string'
            ? [keys]
            : Object.keys(keys);
        for (const key of requested) result[key] = storageData[key];
        return result;
      },
      async set(values: Record<string, unknown>) {
        Object.assign(storageData, values);
        emitStorageChange(
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, { newValue: value }])
          )
        );
      },
      async remove(keys: string | string[]) {
        const requested = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, unknown> = {};
        for (const key of requested) {
          if (key in storageData) changes[key] = { oldValue: storageData[key] };
          delete storageData[key];
        }
        emitStorageChange(changes);
      },
    },
    onChanged: {
      addListener(callback: (changes: Record<string, unknown>, areaName: string) => void) {
        listeners.push(callback);
      },
      removeListener(callback: (changes: Record<string, unknown>, areaName: string) => void) {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
  },
  runtime: {
    getManifest: () => ({ version: PRODUCT_VERSION, permissions: ['bookmarks', 'readingList'] }),
    getURL(path: string) {
      const [file, hash] = path.split('#');
      if (file === 'options.html') {
        return `/src/dev/index.html${window.location.search}${hash ? `#${hash}` : ''}`;
      }
      return `/${path}`;
    },
    async sendMessage(message: { type: string; refreshConnection?: boolean }) {
      if (message.type === 'NOTION_OAUTH') {
        activeScenarioId = 'connected';
        await chromeMock.storage.local.set({ session_token: 'demo-session' });
        return { success: true };
      }
      if (message.type === 'SYNC_ALL_BOOKMARKS') {
        await chromeMock.storage.local.set({
          sync_in_progress: false,
          last_sync: new Date(frozenNow).toISOString(),
          last_sync_error: undefined,
        });
        return { success: true, noChanges: false };
      }
      if (message.type === 'SAVE_CURRENT_PAGE') {
        return { success: true };
      }
      if (message.type === 'GET_USER_PROFILE') {
        const scenario = activeScenario();
        return {
          success: true,
          profile: {
            isPro: scenario.plan === 'pro',
            plan: scenario.plan,
            purchaseType: scenario.plan === 'pro' ? 'monthly' : undefined,
            subscriptionSource: scenario.plan === 'pro' ? 'paddle' : undefined,
          },
        };
      }
      if (message.type === 'GET_PRICING') {
        return { success: true, pricing: { monthly: 1.5, yearly: 11.9 } };
      }
      if (message.type === 'GET_DASHBOARD_STATE') {
        return { success: true, dashboard: activeScenario().dashboard };
      }
      if (message.type === 'DISCONNECT_NOTION') {
        activeScenarioId = 'disconnected-report';
        await chromeMock.storage.local.set({ notion_connected: false });
        return { success: true };
      }
      if (message.type === 'DELETE_ACCOUNT') {
        activeScenarioId = 'disconnected-report';
        await chromeMock.storage.local.remove([
          'session_token',
          'notion_connected',
          'notion_token',
        ]);
        return { success: true };
      }
      return { success: false, error: 'Unsupported deterministic demo message' };
    },
    openOptionsPage() {
      window.open(`/src/dev/index.html${window.location.search}`, '_blank');
    },
  },
  tabs: {
    async create({ url }: { url: string }) {
      window.open(url, '_blank');
    },
  },
};

window.chrome = chromeMock;
window.__BOOKMARK_ASSISTANT_DEMO__ = {
  scenario: config.scenarioId,
  locale: config.locale,
  frozenTime: config.frozenTime,
  ready: true,
};

export {};
