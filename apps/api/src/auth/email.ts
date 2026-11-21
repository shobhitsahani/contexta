import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[invalid-email]';
  return `${local.slice(0, 1)}***@${domain}`;
}

export class ResendEmailSender implements EmailSender {
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.resend = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (error) {
      // Never include the recipient or body in the thrown message.
      throw new Error('Email delivery failed.');
    }
  }
}

/**
 * Development sender. It intentionally never logs verification/reset URLs or
 * tokens; those are single-use credentials.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'email_queued',
        subject: message.subject,
        to: maskEmail(message.to),
      }),
    );
  }
}

export interface EmailSenderConfig {
  apiKey?: string;
  from: string;
}

export function createEmailSender(config: EmailSenderConfig): EmailSender {
  if (config.apiKey) {
    return new ResendEmailSender(config.apiKey, config.from);
  }
  return new ConsoleEmailSender();
}

export function verificationEmail(params: {
  name: string;
  url: string;
}): EmailMessage & { to: string } {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  return {
    to: '',
    subject: 'Verify your Contexta email',
    text: [
      greeting,
      '',
      'Verify your email address to finish setting up Contexta:',
      params.url,
      '',
      'This link expires in 1 hour and can only be used once.',
      "If you didn't create a Contexta account, you can ignore this email.",
    ].join('\n'),
  };
}

export function passwordResetEmail(params: {
  name: string;
  url: string;
}): EmailMessage & { to: string } {
  const greeting = params.name ? `Hi ${params.name},` : 'Hi,';
  return {
    to: '',
    subject: 'Reset your Contexta password',
    text: [
      greeting,
      '',
      'Use this link to reset your Contexta password:',
      params.url,
      '',
      'This link expires in 1 hour and can only be used once.',
      'If you did not request a reset, no action is needed.',
    ].join('\n'),
  };
}
