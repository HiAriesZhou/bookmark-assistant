# PLAN: AI key auto-detection (key-only settings)

> PR discussion only. This file is not product documentation and should be
> removed before merge (or kept out of the merge commit) per the "no docs
> directory / README stays an entry point" rule.

## Goal

Configuring AI in Settings takes one step: paste a key and save. The server works
out which supported provider the key belongs to, verifies it with the existing
adapter call, stores it in the existing `AiProviderCredential` row and returns an
identity the UI shows the way Cida does: status, model and endpoint host
(for example `deepseek-v4-flash` / `DeepSeek · api.deepseek.com`). Only when
detection fails does the UI reveal an optional Base URL field.

## Interaction flow

1. **No key**: the AI service row reads "Not configured". The API key row has the
   key input, a Save button and the privacy hint. There is no provider picker
   and no separate model row.
2. **Save**: the extension sends `PUT /api/ai/credential { apiKey }`.
3. **Detected**: the server returns `201 { credential }` with `provider`, `model`,
   `host`, `baseUrl` (null for official endpoints) and `keyLastFour`. The AI
   service row now shows a green "Ready · ••••1234" status, the model and
   `Provider · host`.
4. **Not detected**: the server returns `400 { code: 'provider_not_detected' }`.
   The UI shows a localized "No supported provider accepted this key" message
   and reveals an **optional Base URL** field. Saving again sends
   `{ apiKey, baseUrl }`.
5. **Detected, but the account can't be used** (no quota, or no access to the
   default model): the server returns the existing `insufficient_quota` or
   `model_access` code for the provider it found. Nothing is saved and the
   previous key stays active.
6. Removing the key, the batch switch, Pro gating and recent tasks are unchanged.
   A saved custom Base URL is shown prefilled, so replacing the key keeps it.

## Detection order (server, `ai-provider-detection.ts`)

The prefix heuristics only choose and order the candidates. Every result is still
confirmed by the existing `validateApiKey` call (a tiny tool-free model call), so
the key is never trusted on prefix alone.

| Key shape                                | Candidates (in order)     |
| ---------------------------------------- | ------------------------- |
| `sk-ant-…`                               | anthropic                 |
| `AIza…`                                  | gemini                    |
| `gsk_…`                                  | groq                      |
| `sk-proj-` / `sk-svcacct-` / `sk-admin-` | openai                    |
| `sk-` + 32 hex                           | deepseek, openai, minimax |
| other `sk-…`                             | openai, deepseek, minimax |
| JWT-like `eyJ…`                          | minimax, openai, deepseek |
| anything else                            | openai, deepseek, minimax |

- **Limiting exposure**: Anthropic, Gemini and Groq keys have fixed, documented
  prefixes, so keys without those prefixes are never sent to those providers.
  A key with one of those strong prefixes goes only to its own provider.
- **Probes run in parallel** within the adapter's existing 30 s timeout, so the
  slowest case is about one provider round trip rather than six in a row. The
  client timeout for this one call goes up to 45 s.
- **Picking the result, in candidate order**:
  1. If any candidate accepts the key (2xx), that provider wins.
  2. Otherwise, if a candidate recognized the key but refused it (429 quota, or
     404 model access on an official host), its specific error is returned.
  3. Otherwise, if any official candidate was unreachable (network error or 5xx),
     `service_unavailable` is returned, because we can't safely say "not detected".
  4. Otherwise the server returns `provider_not_detected`, which the UI treats
     as recoverable.
- **Paused providers** (`AiProviderControl`) are left out of the candidates. If
  every candidate is paused, the server returns the existing
  `service_provider_paused` response.
- **Backward compatibility**: when a request still includes a valid `provider`
  (older extension builds), that provider is the only candidate, which is
  exactly the old behaviour.
- Gemini rejects bad keys with HTTP 400 `API_KEY_INVALID`. The adapter now
  reports this as `invalid_api_key` instead of `service_unavailable`, so the
  detection logic doesn't misread it as an outage.

### Base URL (only after detection fails)

- **Official host** (for example `https://api.deepseek.com`): the URL pins the
  provider and nothing custom is stored. This also lets the user name a provider
  whose key format doesn't match the heuristics.
- **Any other host** is a custom endpoint. Every provider protocol is probed
  against that base, using each provider's default model:
  - OpenAI: Responses API at `{base}/responses`
  - Anthropic and MiniMax: Messages API at `{base}/v1/messages`
  - DeepSeek and Groq: chat completions at `{base}/chat/completions`
  - Gemini: `{base}/models/{model}:generateContent`

  The first protocol that accepts the key (in heuristic order) wins. On a custom
  endpoint, only 2xx or 429 counts as recognizing the key, because a 404 usually
  means the route doesn't exist.

- **URL policy** (`ai-endpoint-policy.ts`):
  - Hosted (`SELF_HOSTED` unset): https only, default port only, no credentials,
    query or fragment, and the hostname must resolve to public addresses only
    (this reuses the public-page fetcher's private-address rules). The check runs
    again before every provider request, and redirects are refused.
  - Self-hosted (`SELF_HOSTED=true`): http and private or LAN hosts are allowed,
    so operators can point at a local gateway (LiteLLM, vLLM, Ollama with an
    OpenAI-compatible API).

## `AiProviderCredential` change points

- **Schema**: new nullable column `baseUrl TEXT` (migration
  `20261024000000_add_ai_credential_base_url`). Null means the provider's
  official endpoint, so all existing rows keep working without a backfill.
- **Encryption**: when `baseUrl` is set, it is added to the AES-GCM AAD. Someone
  who can write to the database therefore can't redirect a stored key to another
  host. Rows with a null `baseUrl` use exactly the same AAD as today, so existing
  ciphertexts still decrypt.
- **`AiCredentialService.saveVerifiedCredential`** takes an optional `baseUrl`.
  It still writes a single row per account, increments `credentialVersion` on
  every save and reconciles tasks.
- **Credential summary** gains `model`, `host` and `baseUrl`.
  `ActiveAiProviderCredential` gains `baseUrl`.
- **Executor**: `providerFor(provider, model, baseUrl?)` builds the adapter for a
  custom base URL with the guarded fetcher. Changing the endpoint always bumps
  `credentialVersion`, so durable tasks are reconciled the same way as after a
  key rotation.
- `AiProvider` in `@bookmark-assistant/types` is unchanged. No new provider
  value, no shared contract change.

## Risks

- **Key sent to more than one provider**: this only happens for ambiguous keys,
  and only to official TLS endpoints of supported providers, which reject unknown
  keys. Strong-prefix keys go to one provider. Nothing is logged except the
  provider name and the outcome.
- **Validation cost**: only the provider that accepts the key bills the tiny
  16-token probe. Rejected probes cost nothing.
- **SSRF via custom Base URL on hosted**: limited to https on the default port to
  publicly resolving hosts, re-checked before each request, with redirects
  refused. A small DNS-rebinding window remains between the check and `fetch`,
  and is accepted for now (follow-up: pin the resolved address through an undici
  dispatcher).
- **Custom gateways that don't serve the provider's default model name** fail to
  validate. Choosing a model is out of scope (follow-up).
- **Heuristic drift** if providers change key formats: the fallback is an
  explicit official Base URL. The heuristics are table-driven and unit-tested.
- **Mixed versions**: a new extension talking to an old self-hosted server gets
  `invalid_credential_input`, so the server has to be updated first. An old
  extension talking to a new server keeps working through the `provider`
  compatibility path.

## Hosted Free/Pro and self-hosted

- **Hosted**: credential save stays available to any signed-in account, as
  before. Batch AI stays Pro-only on the server (`resolveProEntitlement`).
  Capabilities are still decided on the server. Custom Base URLs are limited to
  public https endpoints.
- **Self-hosted**: no official services or credentials involved. Detection
  calls the providers directly. Private or http Base URLs are allowed for local
  gateways.
- **Stage 2** (account-level single AI key, Pro-only AI): compatible. The
  credential is still one row per service account, and Pro gating can be added
  to `PUT /credential` later without changing detection.

## LiteContext impact

None. No KnowledgeItem or ContextItem contract changes, and no new destinations.
