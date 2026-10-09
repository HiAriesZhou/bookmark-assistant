import { SectionCard } from './SectionCard';
import { productConfig } from '../../product-config';
import {
  FREE_INTERVAL_HOURS,
  PRO_MIN_INTERVAL_HOURS,
  PRO_MIN_INTERVAL_MINUTES,
  useAppStore,
} from '../store';

export function BillingSection() {
  return (
    <SectionCard
      id="billing"
      title="Billing & Plan"
      description="Manage your subscription and plan."
    >
      <div className="text-sm text-gray-600">This section is coming soon.</div>
    </SectionCard>
  );
}

export function NotificationsSection() {
  return (
    <SectionCard
      id="notifications"
      title="Notifications"
      description="Configure reminders and notifications."
    >
      <div className="text-sm text-gray-600">This section is coming soon.</div>
    </SectionCard>
  );
}

export function AdvancedSection() {
  return (
    <SectionCard id="advanced" title="Advanced" description="Advanced configuration.">
      <div className="text-sm text-gray-600">This section is coming soon.</div>
    </SectionCard>
  );
}

export function FAQSection() {
  const faqs: { q: string; a: JSX.Element }[] = [
    {
      q: 'Can I cancel anytime?',
      a: (
        <p>
          Yes. You can cancel Pro at any time from{' '}
          <span className="font-medium">Billing & Plan</span>. You will keep Pro access until the
          end of your current billing period.
        </p>
      ),
    },
    {
      q: 'What payment methods do you accept?',
      a: (
        <p>
          We accept major credit/debit cards (Visa, Mastercard, American Express) and PayPal (where
          available).
        </p>
      ),
    },
    {
      q: 'Is my data secure?',
      a: (
        <div className="space-y-1">
          <p>
            We never store the content of your bookmarks on our servers. Your Notion access is
            granted via OAuth or an optional manual token stored locally by the browser.
          </p>
          <ul className="list-disc pl-5">
            <li>All network traffic uses HTTPS (TLS).</li>
            <li>
              The extension only requests the permissions it needs to read bookmarks and write to
              Notion.
            </li>
            <li>You can revoke access from Notion at any time.</li>
          </ul>
        </div>
      ),
    },
    {
      q: 'Can I upgrade or downgrade later?',
      a: (
        <p>
          Yes. Upgrade to Pro any time from <span className="font-medium">Billing & Plan</span>. If
          you downgrade back to Free, Pro features remain available until the current period ends.
        </p>
      ),
    },
    {
      q: "What's the difference between Free and Pro?",
      a: (
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Free:</strong> bookmark and Reading List sync, manual only, 24-hour interval
          </li>
          <li>
            <strong>Pro:</strong> bookmark and Reading List sync, automatic background sync every 6+
            hours, smart deduplication (saves your Notion API quota), priority processing and
            support, plus upcoming AI tagging & summaries at no extra cost
          </li>
        </ul>
      ),
    },
    {
      q: 'How often does it sync?',
      a: (
        <ul className="list-disc pl-5">
          <li>Free: Manual bookmark and Reading List sync</li>
          <li>
            Pro: Automatic background sync every {PRO_MIN_INTERVAL_MINUTES} minutes (configurable),
            bookmark and Reading List sync
          </li>
          <li>You can always trigger a manual "Sync now" from the Options page.</li>
        </ul>
      ),
    },
    {
      q: 'What exactly gets synced to Notion?',
      a: (
        <ul className="list-disc pl-5">
          <li>Bookmark title and URL</li>
          <li>Folder path (to help organize)</li>
          <li>Date added and last updated</li>
          <li>Favicon (when available)</li>
        </ul>
      ),
    },
    {
      q: 'Does it change my Chrome bookmarks?',
      a: (
        <p>
          No. The extension only reads your bookmarks and writes entries into your Notion database.
        </p>
      ),
    },
    {
      q: 'Do I need to keep Chrome open for auto‑sync?',
      a: (
        <p>
          Yes. Scheduled syncs run while Chrome is running. If Chrome is fully closed, sync resumes
          the next time you open the browser.
        </p>
      ),
    },
    {
      q: 'Notion access: why do I get a permissions error?',
      a: (
        <div className="space-y-1">
          <p>
            Make sure you have shared your target Notion database with the integration you
            connected. In Notion, open the database • Share • Invite the integration.
          </p>
          <p>For manual tokens, double‑check both the token and the Database ID.</p>
          <p className="text-gray-500">
            Note: OAuth is recommended for the Chrome Web Store release; manual token is an advanced
            connection option.
          </p>
        </div>
      ),
    },
    {
      q: 'Where can I find my Notion Database ID?',
      a: (
        <div className="space-y-1">
          <p>
            Open the database in Notion. The URL contains the ID after the last slash and before the
            question mark. Example: notion.so/…/<span className="font-mono">abcdef1234567890</span>
            ?v=…
          </p>
        </div>
      ),
    },
    {
      q: 'Troubleshooting tips',
      a: (
        <ul className="list-disc pl-5">
          <li>Click “Connect with Notion” again to refresh OAuth permissions.</li>
          <li>Verify the database is shared with the integration in Notion.</li>
          <li>Check the status area for any error message after a sync attempt.</li>
          <li>Try a manual “Sync now” to force a refresh.</li>
        </ul>
      ),
    },
    ...(productConfig.supportUrl
      ? [
          {
            q: 'How do I contact support?',
            a: (
              <p>
                <a
                  href={productConfig.supportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:text-amber-700 underline"
                >
                  Contact support
                </a>
              </p>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionCard id="faq" title="FAQ" description="Answers to common questions.">
      <div className="space-y-3">
        {faqs.map((item, idx) => (
          <details key={idx} className="group rounded-lg border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 flex items-center justify-between">
              {item.q}
              <span className="ml-2 text-gray-400 group-open:rotate-180 transition-transform">
                ▾
              </span>
            </summary>
            <div className="mt-2 text-sm text-gray-700">{item.a}</div>
          </details>
        ))}
      </div>
      {/* <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
        <div className="text-gray-700 font-medium mb-4">Have more questions?</div>
        <a
          className="flex w-full max-w-md mx-auto rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 items-center justify-center gap-2"
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="w-4 h-4" />
          Contact Support
        </a>
      </div> */}
    </SectionCard>
  );
}

export function TutorialsSection() {
  const { isPro } = useAppStore();
  return (
    <SectionCard
      id="tutorials"
      title="Tutorials"
      description="Step-by-step guides to get you syncing."
    >
      <div className="space-y-6 text-sm text-gray-800">
        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">1) Install the extension</h3>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Open the Chrome Web Store and install “Notion Bookmark Sync”.</li>
            <li>Pin the extension: click the puzzle icon • pin the extension for quick access.</li>
            <li>
              Open Options: right‑click the extension • Options, or click the extension icon •
              Options.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">2) Prepare Notion</h3>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Choose or create a Notion database to store bookmarks (Table view recommended).</li>
            <li>If using our template, duplicate it to your workspace and use that database.</li>
            <li>Ensure your Notion account has access to that database.</li>
          </ol>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">3) Connect to Notion</h3>
          <div className="rounded-md border border-gray-200 p-3 bg-white">
            <p className="mb-2 text-gray-700">
              <span className="font-medium">Option A — OAuth (recommended):</span>
              <span className="ml-1 text-gray-500">
                (available in the Chrome Web Store release)
              </span>
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-gray-700">
              <li>In the Options • General • Connection, click “Connect with Notion”.</li>
              <li>Sign in to Notion and approve access for the integration.</li>
              <li>Select the database to share with the integration when prompted.</li>
            </ol>
            <p className="mt-3 mb-2 text-gray-700">
              <span className="font-medium">Option B — Manual token (advanced):</span>
              <span className="ml-1 text-gray-500">(advanced connection option)</span>
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-gray-700">
              <li>Create a Notion internal integration and copy its secret token.</li>
              <li>Share your bookmarks database with that integration in Notion.</li>
              <li>
                Paste <span className="font-mono">Token</span> and{' '}
                <span className="font-mono">Database ID</span> into Options • Connection • Manual,
                then Save.
              </li>
            </ol>
          </div>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">4) First sync</h3>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Once connected, click “Sync now” to push your current bookmarks into Notion.</li>
            <li>
              Keep the Options page open until the first sync completes. Progress appears in the
              status area.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">5) Auto sync and intervals</h3>
          <div className="rounded-md border border-gray-200 p-3 bg-white">
            <p className="text-gray-700">
              Toggle “Auto sync” in Options • General • Sync Settings to keep Notion up‑to‑date.
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-700">
              {!isPro && (
                <li>
                  Free plan: the sync interval is fixed to{' '}
                  <span className="font-medium">{FREE_INTERVAL_HOURS} hours</span>.
                </li>
              )}
              {isPro && (
                <li>
                  Pro plan: choose your own interval (minimum{' '}
                  {Math.round(PRO_MIN_INTERVAL_HOURS * 60)} minutes).
                </li>
              )}
            </ul>
          </div>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">6) Tips</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>You can re‑run “Sync now” anytime to pick up changes.</li>
            <li>Make sure the integration has access to the chosen Notion database.</li>
            <li>For manual token mode, double‑check both the token and database ID.</li>
          </ul>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">7) Troubleshooting</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>If you see “Not connected”, click “Connect with Notion” again to re‑authorize.</li>
            <li>
              Ensure your Notion workspace isn’t blocking the integration (workspace admins can
              restrict apps).
            </li>
            <li>
              Large bookmark libraries may take time; you can keep browsing while background sync
              continues.
            </li>
            <li>
              Errors usually include a hint (e.g., permission, invalid token, rate limit). Adjust
              and retry.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-2">8) Upgrading to Pro</h3>
          <p className="text-gray-700">
            Visit Billing & Plan to upgrade. After checkout, the app will reflect Pro and unlock
            shorter intervals.
          </p>
        </section>
      </div>
    </SectionCard>
  );
}
