const SMTP_PROVIDER = process.env.SMTP_PROVIDER ?? "gmail";

const smtpProviders = {
  gmail: {
    dailyLimit: 80,
    hourlyLimit: 10,
    delayMinMs: 60000,
    delayMaxMs: 120000,
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  },
  zoho: {
    dailyLimit: 150,
    hourlyLimit: 20,
    delayMinMs: 45000,
    delayMaxMs: 90000,
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_USER,
      pass: process.env.ZOHO_PASSWORD
    }
  },
  amazon_ses: {
    dailyLimit: 500,
    hourlyLimit: 100,
    delayMinMs: 10000,
    delayMaxMs: 30000,
    host: process.env.AMAZON_SES_HOST,
    port: Number.parseInt(process.env.AMAZON_SES_PORT ?? "587", 10),
    secure: false,
    auth: {
      user: process.env.AMAZON_SES_USER,
      pass: process.env.AMAZON_SES_PASSWORD
    }
  },
  resend: {
    dailyLimit: 3000,
    hourlyLimit: 500,
    delayMinMs: 3000,
    delayMaxMs: 10000,
    host: process.env.RESEND_SMTP_HOST,
    port: Number.parseInt(process.env.RESEND_SMTP_PORT ?? "587", 10),
    secure: false,
    auth: {
      user: process.env.RESEND_SMTP_USER,
      pass: process.env.RESEND_SMTP_PASSWORD
    }
  },
  sendgrid: {
    dailyLimit: 1000,
    hourlyLimit: 200,
    delayMinMs: 5000,
    delayMaxMs: 15000,
    host: process.env.SENDGRID_SMTP_HOST,
    port: Number.parseInt(process.env.SENDGRID_SMTP_PORT ?? "587", 10),
    secure: false,
    auth: {
      user: process.env.SENDGRID_SMTP_USER,
      pass: process.env.SENDGRID_SMTP_PASSWORD
    }
  }
};

const getSmtpProviderName = () => {
  return smtpProviders[SMTP_PROVIDER] ? SMTP_PROVIDER : "gmail";
};

const getSmtpProviderConfig = () => {
  return {
    name: getSmtpProviderName(),
    ...smtpProviders[getSmtpProviderName()]
  };
};

const getSmtpDelayWindow = () => {
  const provider = getSmtpProviderConfig();
  return {
    minMs: provider.delayMinMs,
    maxMs: provider.delayMaxMs
  };
};

export { SMTP_PROVIDER, getSmtpDelayWindow, getSmtpProviderConfig, getSmtpProviderName, smtpProviders };
