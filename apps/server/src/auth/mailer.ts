/** Sends sign-in emails. */
export interface Mailer {
  sendLoginLink(email: string, link: string): Promise<void>;
}

/** Development: prints the link instead of emailing it. */
export const consoleMailer: Mailer = {
  sendLoginLink(email, link) {
    console.log(`\n  Sign-in link for ${email}:\n  ${link}\n`);
    return Promise.resolve();
  },
};

/** Production: sends the email through Resend's HTTP API. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async sendLoginLink(email, link) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: email,
          subject: 'Your Card Table sign-in link',
          text: `Click to sign in to Card Table:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
        }),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text()}`);
    },
  };
}
