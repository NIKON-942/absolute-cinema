export interface AppConfig {
  port: number;
  clientUrl: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  jwt: { secret: string; expiresIn: string };
  google: { clientId: string; clientSecret: string; callbackUrl: string };
  stripe: { enabled: boolean; secretKey: string; webhookSecret: string };
  smtp: { host: string; port: number; user: string; pass: string; from: string };
}

export const configuration = (): AppConfig => {
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET ?? '';
    if (secret.length < 32 || /^(dev-only-secret|change-me|replace[-_])/i.test(secret)) {
      throw new Error('Production JWT_SECRET must be a random secret of at least 32 characters');
    }
    if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'cinema') {
      throw new Error('Production DB_PASSWORD must be set and differ from the demo password');
    }
    if (!process.env.CLIENT_URL) {
      throw new Error('Production CLIENT_URL must be set to the public application origin');
    }
  }
  return {
    port: parseInt(process.env.PORT ?? '4000', 10),
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      user: process.env.DB_USER ?? 'cinema',
      password: process.env.DB_PASSWORD ?? 'cinema',
      name: process.env.DB_NAME ?? 'absolutecinema',
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackUrl:
        process.env.GOOGLE_CALLBACK_URL ??
        'http://localhost:4000/api/auth/google/callback',
    },
    stripe: {
      enabled: process.env.STRIPE_ENABLED === 'true',
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from:
        process.env.MAIL_FROM ??
        'AbsoluteCinema <no-reply@absolutecinema.local>',
    },
  };
};
