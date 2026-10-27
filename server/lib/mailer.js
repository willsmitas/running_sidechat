import config from '../config.js';

let transport = null;

async function getTransport() {
  if (!config.smtpUrl) return null;
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.default.createTransport(config.smtpUrl);
  }
  return transport;
}

export const sentMail = []; // kept in memory for tests / dev inspection

export async function sendMail({ to, subject, text }) {
  const t = await getTransport();
  if (!t) {
    sentMail.push({ to, subject, text, at: Date.now() });
    if (sentMail.length > 50) sentMail.shift();
    if (!config.isTest) console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await t.sendMail({ from: config.mailFrom, to, subject, text });
}

export function codeEmail(code, purpose) {
  const what = {
    signup: 'finish creating your account',
    college: 'verify your college email',
    reset: 'reset your password',
  }[purpose] || 'continue';
  return {
    subject: `${code} is your ${config.appName} code`,
    text: `Your ${config.appName} code is ${code}.\n\nEnter it to ${what}. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email. We never store your email address in readable form.`,
  };
}
