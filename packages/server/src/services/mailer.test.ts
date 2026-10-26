/**
 * Login email delivery. Provider responses stay off the client and out of logs.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  selfHosted: false,
  resendApiKey: '',
  emailFrom: 'Bookmark Assistant <login@bookmarkassistant.com>',
}));

vi.mock('../config', () => ({
  config: {
    get selfHosted() {
      return state.selfHosted;
    },
    get resendApiKey() {
      return state.resendApiKey;
    },
    get emailFrom() {
      return state.emailFrom;
    },
  },
}));

import { emailDeliveryMode, sendLoginCode } from './mailer';

describe('login mailer', () => {
  afterEach(() => {
    state.selfHosted = false;
    state.resendApiKey = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats hosted email sign-in as disabled until Resend is configured', () => {
    expect(emailDeliveryMode()).toBe('disabled');
  });

  it('logs the code once for a self-hosted server without Resend', async () => {
    state.selfHosted = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLoginCode({ email: 'person@example.com', code: '424242' })).resolves.toBe(
      'logged'
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain('424242');
    expect(line).not.toContain('person@example.com');
    expect(line).not.toMatch(/https?:/);
  });

  it('posts a bilingual code email through Resend without echoing provider errors', async () => {
    state.resendApiKey = 'test-resend-key';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'provider-secret-detail' }), { status: 500 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLoginCode({ email: 'person@example.com', code: '424242' })).rejects.toThrow(
      /could not be sent/i
    );
    await expect(
      sendLoginCode({ email: 'person@example.com', code: '424242' })
    ).rejects.not.toThrow(/provider-secret-detail/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-resend-key');
    const payload = JSON.parse(init.body);
    expect(payload.to).toEqual(['person@example.com']);
    expect(payload.text).toContain('424242');
    expect(payload.text).toContain('10');
    expect(payload.text).toMatch(/验证码/);
    expect(payload.text).not.toMatch(/https?:/);
    expect(error.mock.calls.flat().join('\n')).not.toContain('provider-secret-detail');
  });
});
