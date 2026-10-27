'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  AlignLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  ChevronDown,
  Download,
  Globe2,
  LayoutGrid,
  Table2,
  Tags,
  Type,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Logo } from '@/components/icons/Logo';
import type { WebsiteCopy, WebsiteLocale } from '@/lib/i18n';
import { localePath } from '@/lib/i18n';
import {
  CHROME_WEB_STORE_URL,
  PRODUCT_HUNT_URL,
  PRODUCT_NAME,
  ASSET_PREFIX,
} from '@/lib/product-links';

const LiquidGlass = dynamic(() => import('liquid-glass-react'), { ssr: false });
const PRODUCT_HUNT_BADGE =
  'https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1055606&theme=neutral&t=1789456451207';

type Article = {
  title: string;
  displayTitle: string;
  source: string;
  group: number;
  category: string;
  tags: string[];
  date: string;
  dateLabel: string;
  description: string;
  number: string;
};

const ENTRIES = [
  [
    'Less, but better',
    '好的设计，让复杂变得简单',
    'LESS, BUT BETTER.',
    'Design notes',
    0,
    'A closer look at white space, thoughtful tools, and making room for what matters.',
    '关于留白、秩序与日常工具的思考。给真正重要的内容，一个清楚的位置。',
  ],
  [
    'Grow a garden of ideas',
    '建立自己的知识花园',
    'A GARDEN OF IDEAS.',
    'Reading journal',
    1,
    'Connect the things you read. Let a collection of links grow into a body of knowledge.',
    '将零散的阅读连接起来，让收藏慢慢生长为自己的知识。',
  ],
  [
    'Make room to think',
    '为专注留一点空间',
    'ROOM TO THINK.',
    'Fieldwork',
    2,
    'Fewer distractions. More useful connections. A quieter space for your digital life.',
    '减少切换，留下有意义的线索。一个更安静的数字工作空间。',
  ],
  [
    'Your browser, a little library',
    '浏览器里的小小图书馆',
    'COLLECT WITH CARE.',
    'The internet archive',
    3,
    'Articles, tools, and ideas you want to come back to. Everything in its own place.',
    '那些想再次打开的文章、工具和灵感，都有自己的位置。',
  ],
  [
    'Turn reading into practice',
    '从阅读，到下一次实践',
    'MAKE IT YOURS.',
    'Working notes',
    1,
    'Keep something worth putting into practice. A bookmark can be the start of your next project.',
    '让一条收藏成为下一次行动的起点，而不只是一个链接。',
  ],
] as const;

function buildArticles(locale: WebsiteLocale): Article[] {
  const zh = locale === 'zh-CN';
  const categories = zh
    ? ['设计', '阅读', '灵感', '工具']
    : ['Design', 'Reading', 'Ideas', 'Tools'];
  const topics = zh
    ? [
        ['极简主义', '界面设计'],
        ['知识管理', '学习'],
        ['专注', '数字生活'],
        ['浏览器', '效率'],
        ['实践', '学习'],
      ]
    : [
        ['Minimalism', 'UI design'],
        ['Knowledge', 'Learning'],
        ['Focus', 'Digital life'],
        ['Browser', 'Productivity'],
        ['Practice', 'Learning'],
      ];
  return ENTRIES.map((entry, index) => ({
    title: zh ? entry[1] : entry[0],
    displayTitle: zh ? entry[1] : entry[2],
    source: entry[3],
    group: entry[4],
    category: categories[entry[4]],
    tags: [categories[entry[4]], ...topics[index]],
    date: `2026-09-${15 - index}`,
    dateLabel: zh ? `2026年9月${15 - index}日` : `Sep ${15 - index}, 2026`,
    description: zh ? entry[6] : entry[5],
    number: `0${index + 1}`,
  }));
}

function InstallLink({ label, navigation = false }: { label: string; navigation?: boolean }) {
  return (
    <a
      className={`editorial-install${navigation ? ' editorial-install-nav' : ''}`}
      href={CHROME_WEB_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} for Chrome`}
    >
      {navigation ? (
        <span className="editorial-install-swap" aria-hidden="true">
          <Image src={`${ASSET_PREFIX}/assets/chrome.svg`} alt="" width={18} height={18} />
          <Download size={18} strokeWidth={1.7} />
        </span>
      ) : (
        <Image src={`${ASSET_PREFIX}/assets/chrome.svg`} alt="" width={18} height={18} />
      )}
      <span>{label}</span>
    </a>
  );
}

function PaperCard({
  article,
  active = false,
  decorative = false,
  onSelect,
}: {
  article: Article;
  active?: boolean;
  decorative?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <div className="editorial-paper-top">
        {PRODUCT_NAME.toUpperCase()} <span>{article.number} / COLLECTION</span>
      </div>
      <h3>{article.displayTitle}</h3>
      <div className="editorial-paper-rule" />
      <p>{article.description}</p>
      <div className="editorial-paper-bottom">
        <span>{article.source}</span>
        <span>{article.category}</span>
      </div>
    </>
  );
  if (decorative) return <div className="editorial-paper">{content}</div>;
  return (
    <button type="button" className="editorial-paper" aria-pressed={active} onClick={onSelect}>
      {content}
    </button>
  );
}

function FrostedMetadata({
  children,
  backdropArticles,
}: {
  children: ReactNode;
  backdropArticles: Article[];
}) {
  return (
    <div className="editorial-frosted-metadata">
      <div className="editorial-frosted-stage">
        <div className="editorial-frosted-cards" aria-hidden="true">
          {backdropArticles.map((article, index) => (
            <div
              className={`editorial-under-card editorial-under-card-${index}`}
              key={article.number}
            >
              <PaperCard article={article} decorative />
            </div>
          ))}
        </div>
        <LiquidGlass
          className="editorial-frosted-lens"
          displacementScale={16}
          blurAmount={0.32}
          saturation={105}
          aberrationIntensity={0}
          elasticity={0}
          cornerRadius={23}
          padding="0"
          style={{ position: 'absolute', inset: '0 0 auto 0', width: '100%' }}
        >
          {children}
        </LiquidGlass>
      </div>
    </div>
  );
}

function NotionPreview({ articles, locale }: { articles: Article[]; locale: WebsiteLocale }) {
  const zh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [opened, setOpened] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setPanelHeight(content.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const renderTags = (article: Article) => (
    <div className="editorial-sync-tags">
      {article.tags.map((tag, index) => (
        <span className={`editorial-tag editorial-tag-${(article.group + index) % 4}`} key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );

  return (
    <section className="editorial-section editorial-sync" id="sync">
      <div className="editorial-section-head">
        <div>
          <div className="editorial-eyebrow">
            {t('02 / OPTIONAL NOTION SYNC', '02 / 可选 NOTION 同步')}
          </div>
          <h2>
            {t('Keep them in Chrome.', '保留在 Chrome。')}
            <br />
            <em>{t('Sync when you choose.', '需要时再同步。')}</em>
          </h2>
        </div>
        <p>
          {t(
            'Send bookmarks and Reading List to Notion on demand.',
            '按需将书签与阅读清单同步到 Notion。'
          )}
          <br />
          {t('No migration to another bookmark service.', '无需迁移到另一套书签服务。')}
        </p>
      </div>
      <div className="editorial-sync-demo">
        <div className="editorial-sync-destination">
          <span>
            <Image src={`${ASSET_PREFIX}/assets/chrome.svg`} alt="" width={17} height={17} />
            {t('Bookmarks + Reading List', '书签 + 阅读清单')}
          </span>
          <ArrowRight size={15} aria-hidden="true" />
          <span>
            <b aria-hidden="true">N</b>Notion
          </span>
          <small>{t('Interactive preview', '交互预览')}</small>
        </div>
        <div className="editorial-sync-page-heading">
          <span aria-hidden="true">↗</span>
          <h3>{t('My collection', '我的收藏库')}</h3>
          <p>{t('Good things, kept together.', '把值得留下的内容，放在一起。')}</p>
        </div>
        <div className="editorial-sync-toolbar">
          <div role="tablist" aria-label={t('Collection view', '收藏视图')}>
            {(
              [
                ['table', Table2, t('Table', '表格')],
                ['cards', LayoutGrid, t('Cards', '卡片')],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                aria-controls="editorial-sync-panel"
                onClick={() => setView(id)}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <span className="editorial-sync-hint">
            <span aria-hidden="true">👈</span>
            {t('Try another view', '点击切换视图')}
          </span>
        </div>
        <div
          id="editorial-sync-panel"
          className="editorial-sync-panel"
          style={{ height: panelHeight === null ? 'auto' : panelHeight }}
          role="tabpanel"
        >
          <div ref={contentRef} className="editorial-sync-measure">
            <div key={view} className="editorial-sync-enter">
              {view === 'table' ? (
                <div className="editorial-sync-table-scroll">
                  <table className="editorial-sync-table">
                    <thead>
                      <tr>
                        {[
                          [Type, t('Name', '名称')],
                          [CalendarDays, t('Date', '日期')],
                          [Tags, t('Tags', '标签')],
                          [AlignLeft, t('Description', '描述')],
                        ].map(([Icon, label]) => (
                          <th scope="col" key={label as string}>
                            <span>
                              <Icon size={13} aria-hidden="true" />
                              {label as string}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {articles.map((article) => (
                        <FragmentRow
                          key={article.number}
                          article={article}
                          opened={opened === article.number}
                          setOpened={setOpened}
                          renderTags={renderTags}
                          locale={locale}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="editorial-sync-card-grid">
                  {articles.map((article) => (
                    <article className="editorial-sync-card" key={article.number}>
                      <button
                        type="button"
                        className="editorial-sync-card-title"
                        aria-expanded={opened === article.number}
                        onClick={() => setOpened(opened === article.number ? null : article.number)}
                      >
                        <span
                          className={`editorial-favicon editorial-favicon-${article.group}`}
                          aria-hidden="true"
                        >
                          {['↗', '▤', '✳', '⌘'][article.group]}
                        </span>
                        <span>{article.title}</span>
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                      <time dateTime={article.date}>{article.dateLabel}</time>
                      <span className="editorial-sync-card-source">{article.source}</span>
                      <p>{article.description}</p>
                      {renderTags(article)}
                      {opened === article.number ? (
                        <div className="editorial-sync-card-extra">
                          https://example.org/reading/{article.number}
                          <br />
                          {t('Folder', '文件夹')}: {article.category}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="editorial-sync-foot">
          <span>
            {articles.length} {t('bookmarks', '条书签')}
          </span>
          <span>{t('Select a title to see its URL and folder', '点击标题，查看网址与文件夹')}</span>
        </div>
      </div>
      <p className="editorial-sync-note">
        {t(
          'Sample data · No connection to your Notion account.',
          '示例数据 · 不连接你的 Notion 账户。'
        )}
      </p>
    </section>
  );
}

function FragmentRow({
  article,
  opened,
  setOpened,
  renderTags,
  locale,
}: {
  article: Article;
  opened: boolean;
  setOpened: (value: string | null) => void;
  renderTags: (article: Article) => ReactNode;
  locale: WebsiteLocale;
}) {
  const folder = locale === 'zh-CN' ? '文件夹' : 'Folder';
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="editorial-record-trigger"
            aria-expanded={opened}
            onClick={() => setOpened(opened ? null : article.number)}
          >
            <span>{article.title}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </td>
        <td>
          <time dateTime={article.date}>{article.dateLabel}</time>
        </td>
        <td>{renderTags(article)}</td>
        <td>{article.description}</td>
      </tr>
      {opened ? (
        <tr className="editorial-sync-expanded">
          <td colSpan={4}>
            <Globe2 size={14} aria-hidden="true" />
            <span>https://example.org/reading/{article.number}</span>
            <span>
              {folder}: {article.category}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function EditorialLanding({ copy, locale }: { copy: WebsiteCopy; locale: WebsiteLocale }) {
  const zh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const articles = buildArticles(locale);
  const [selected, setSelected] = useState(0);
  const article = articles[selected];

  return (
    <div className="editorial-site">
      <header className="editorial-header">
        <a className="editorial-brand" href="#top" aria-label={`${PRODUCT_NAME} home`}>
          <Logo />
          <span>{PRODUCT_NAME}</span>
        </a>
        <div className="editorial-header-actions">
          <nav aria-label={t('Main navigation', '主导航')}>
            {[
              ['library', t('Library', '书签库')],
              ['sync', t('Sync', '同步')],
              ['ai', 'AI'],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
                <Bookmark size={13} strokeWidth={1.6} aria-hidden="true" />
              </a>
            ))}
          </nav>
          <a className="editorial-signin" href={localePath(locale, 'signin')}>
            {t('Log in', '登录')}
          </a>
          <InstallLink label={copy.ctas.primary} navigation />
        </div>
      </header>

      <section className="editorial-hero">
        <div className="editorial-hero-copy">
          <div className="editorial-eyebrow">{copy.hero.aiEyebrow}</div>
          <h1>
            {t('Your Chrome bookmarks.', '管理 Chrome 书签。')}
            <br />
            <em>{t('Still in Chrome.', '不必迁移。')}</em>
          </h1>
          <p>{copy.hero.aiBody}</p>
          <div className="editorial-actions">
            <InstallLink label={copy.ctas.primary} />
            {PRODUCT_HUNT_URL ? (
              <a
                className="editorial-ph"
                href={PRODUCT_HUNT_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img alt={copy.hero.productHunt} width="250" height="54" src={PRODUCT_HUNT_BADGE} />
              </a>
            ) : null}
          </div>
        </div>
        <div className="editorial-hero-visual">
          <Image
            className="editorial-laptop"
            src={`${ASSET_PREFIX}/assets/laptop-${locale}.png`}
            alt={copy.hero.imageAlt}
            width={1536}
            height={1024}
            priority
          />
          <div className="editorial-hero-note">
            <span />
            <strong>{copy.hero.imageNote}</strong>
            <small>01—05</small>
          </div>
        </div>
      </section>

      <section className="editorial-section editorial-library" id="library">
        <div className="editorial-section-head">
          <div>
            <div className="editorial-eyebrow">
              {t('01 / LOCAL BOOKMARK MANAGEMENT', '01 / 本地书签管理')}
            </div>
            <h2>
              {t('Your Chrome bookmarks.', '你的 Chrome 书签，')}
              <br />
              <em>{t('In order.', '井然有序。')}</em>
            </h2>
          </div>
          <p>
            {t(
              'Search, edit, tag, move, and remove bookmarks locally.',
              '在本地搜索、编辑、加标签、移动和删除书签。'
            )}
            <br />
            {t(
              'They remain in Chrome as your source of truth.',
              '它们仍保留在 Chrome，作为事实来源。'
            )}
          </p>
        </div>
        <div className="editorial-library-workbench">
          <div className="editorial-paper-stage">
            {articles.slice(0, 4).map((item, index) => (
              <div
                className={`editorial-paper-position editorial-paper-position-${index}${selected === index ? ' is-selected' : ''}`}
                key={item.number}
              >
                <PaperCard
                  article={item}
                  active={selected === index}
                  onSelect={() => setSelected(index)}
                />
              </div>
            ))}
          </div>
          <FrostedMetadata backdropArticles={[articles[0], articles[2]]}>
            <div
              className="editorial-metadata"
              role="region"
              aria-label={t('Bookmark metadata', '书签元数据')}
              aria-live="polite"
            >
              <div className="editorial-metadata-head">
                <span>{t('BOOKMARK METADATA', '书签元数据')}</span>
                <span>{t('Sample · stored locally', '示例 · 本地保存')}</span>
              </div>
              <dl>
                <div>
                  <dt>{t('Title', '标题')}</dt>
                  <dd>{article.title}</dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd>https://example.org/reading/{article.number}</dd>
                </div>
                <div>
                  <dt>{t('Description', '描述')}</dt>
                  <dd>
                    {article.description}
                    <span className="editorial-ai-label">AI</span>
                  </dd>
                </div>
                <div>
                  <dt>{t('Folder', '文件夹')}</dt>
                  <dd>
                    {t('Bookmarks bar', '书签栏')} / {article.category}
                  </dd>
                </div>
                <div>
                  <dt>{t('Tags', '标签')}</dt>
                  <dd>
                    {article.tags.map((tag) => (
                      <span className="editorial-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          </FrostedMetadata>
        </div>
        <div className="editorial-ai-note" id="ai">
          <strong>{t('Optional AI enrichment', '可选 AI 增强')}</strong>
          <p>
            {t(
              'For eligible newly saved public pages, add a short summary and useful tags.',
              '为符合条件的新保存公开网页添加简短摘要与实用标签。'
            )}
            <small>
              {t('Optional · Generated content stays editable.', '可选功能 · 生成内容仍可编辑。')}
            </small>
          </p>
        </div>
      </section>

      <NotionPreview articles={articles} locale={locale} />
    </div>
  );
}
