// Login email delivery. Resend is called with fetch so this phase adds no mail dependency.

import { createHash } from 'node:crypto';
import { config } from '../config';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DELIVERY_TIMEOUT_MS = 10_000;
const CODE_TTL_MINUTES = 10;

export type EmailDeliveryMode = 'resend' | 'log' | 'disabled';

export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export function emailDeliveryMode(): EmailDeliveryMode {
  if (config.resendApiKey) return 'resend';
  if (config.selfHosted) return 'log';
  return 'disabled';
}

/** Short stable reference for logs. The address itself is not written. */
export function emailLogRef(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function messageFor(code: string, locale?: string): { subject: string; text: string } {
  const english = [
    `Your Bookmark Assistant sign-in code is ${code}.`,
    '',
    `This code expires in ${CODE_TTL_MINUTES} minutes.`,
    '',
    'If you did not request it, you can ignore this email.',
  ].join('\n');
  const chinese = [
    `你的 Bookmark Assistant 登录验证码是 ${code}。`,
    '',
    `验证码 ${CODE_TTL_MINUTES} 分钟内有效。`,
    '',
    '如果这不是你本人操作，请忽略这封邮件。',
  ].join('\n');
  const language = locale?.toLowerCase() ?? '';
  if (language.startsWith('zh')) {
    return { subject: 'Bookmark Assistant 登录验证码', text: chinese };
  }
  if (language.startsWith('en')) {
    return { subject: 'Your Bookmark Assistant sign-in code', text: english };
  }
  return { subject: 'Bookmark Assistant sign-in code', text: `${english}\n\n${chinese}` };
}

/**
 * Sends a one-time code. Self-hosted servers without Resend print one console line
 * so a personal install can sign in; that line is the only place the code is logged.
 */
export async function sendLoginCode(input: {
  email: string;
  code: string;
  locale?: string;
}): Promise<'sent' | 'logged'> {
  const mode = emailDeliveryMode();
  if (mode === 'disabled') {
    throw new MailDeliveryError('Email sign-in is not enabled for this server.');
  }
  const message = messageFor(input.code, input.locale);
  if (mode === 'log') {
    console.info(
      `[email-login] delivery=console ref=${emailLogRef(input.email)} code=${input.code} expires_in=${CODE_TTL_MINUTES}m`
    );
    return 'logged';
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [input.email],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[email-login] delivery failed', response.status);
      throw new MailDeliveryError('The sign-in email could not be sent.');
    }
    return 'sent';
  } catch (error) {
    if (error instanceof MailDeliveryError) throw error;
    console.error('[email-login] delivery failed');
    throw new MailDeliveryError('The sign-in email could not be sent.');
  }
}
