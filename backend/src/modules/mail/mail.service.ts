import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { AppConfig } from "../../config/configuration";
import { escapeHtml as esc, safeHttpUrl } from "../../common/helpers/escape-html";

type Lang = "en" | "uk";

/** Formats an amount in its own currency instead of assuming dollars. */
function money(amount: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Sends e-mails through SMTP: welcome, password reset and payment receipt. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService<AppConfig, true>) {
    const smtp = config.get("smtp", { infer: true })!;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      // Implicit TLS on the standard SMTPS port; other ports upgrade with STARTTLS when offered.
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  /** Email delivery must never break auth/payment flows — log and continue. */
  private send(to: string, subject: string, html: string): void {
    const from = this.config.get("smtp", { infer: true })!.from;
    this.transporter?.sendMail({ from, to, subject, html }).catch((err) => {
      this.logger.warn(`Mail delivery failed (${subject}): ${err.message}`);
    });
  }

  // e-mail after registration
  sendWelcome(to: string, name: string, lang: Lang = "en"): void {
    const t =
      lang === "uk"
        ? {
            subject: "Ласкаво просимо до AbsoluteCinema",
            title: `Вітаємо, ${esc(name)}!`,
            body: "Ваш обліковий запис створено. Тисячі фільмів вже чекають на вас.",
            cta: "Почати перегляд",
          }
        : {
            subject: "Welcome to AbsoluteCinema",
            title: `Welcome, ${esc(name)}!`,
            body: "Your account has been created. Thousands of movies are waiting for you.",
            cta: "Start watching",
          };
    this.send(to, t.subject, this.layout(t.title, t.body, t.cta, this.siteUrl()));
  }

  // e-mail with the reset link
  sendPasswordReset(to: string, resetUrl: string, lang: Lang = "en"): void {
    const t =
      lang === "uk"
        ? {
            subject: "Скидання паролю AbsoluteCinema",
            title: "Скидання паролю",
            body: "Перейдіть за посиланням нижче, щоб встановити новий пароль. Посилання діє 24 години.",
            cta: "Скинути пароль",
          }
        : {
            subject: "AbsoluteCinema password reset",
            title: "Password reset",
            body: "Follow the link below to set a new password. The link is valid for 24 hours.",
            cta: "Reset password",
          };
    this.send(to, t.subject, this.layout(t.title, t.body, t.cta, resetUrl));
  }

  // e-mail after a successful payment
  sendReceipt(
    to: string,
    details: {
      tier: string;
      period: string;
      amount: number;
      currency: string;
      endsAt: Date;
      refund?: { amount: number; currency: string } | null;
    },
    lang: Lang = "en",
  ): void {
    const t =
      lang === "uk"
        ? {
            subject: "Квитанція про оплату AbsoluteCinema",
            title: "Платіж отримано",
            body: `Підписку <b>${esc(details.tier)}</b> (${details.period === "monthly" ? "щомісячна" : "річна"}) активовано до ${details.endsAt.toLocaleDateString("uk-UA")}. Списано: ${esc(money(details.amount, details.currency, "uk"))}.${details.refund ? ` Повернення ${details.refund.amount.toFixed(2)} ${esc(details.refund.currency.toUpperCase())} за невикористану частину попередньої підписки надіслано на спосіб оплати, яким ви користувалися.` : ""}`,
            cta: "Дивитися зараз",
          }
        : {
            subject: "AbsoluteCinema payment receipt",
            title: "Payment received",
            body: `Your <b>${esc(details.tier)}</b> subscription (${esc(details.period)}) is active until ${details.endsAt.toISOString().slice(0, 10)}. Charged: ${esc(money(details.amount, details.currency, "en"))}.${details.refund ? ` A refund of ${details.refund.amount.toFixed(2)} ${esc(details.refund.currency.toUpperCase())} for the unused part of your previous subscription has been issued to your original payment method.` : ""}`,
            cta: "Watch now",
          };
    this.send(to, t.subject, this.layout(t.title, t.body, t.cta, this.siteUrl()));
  }

  /** Public site address used for e-mail buttons (the first CLIENT_URL entry). */
  private siteUrl(): string {
    return this.config.get("clientUrl", { infer: true });
  }

  private layout(
    title: string,
    body: string,
    cta: string,
    href?: string,
  ): string {
    const brandIconUrl = new URL(
      "/brand/frog-head.png",
      this.config.get("clientUrl", { infer: true }),
    ).href;
    return `<!doctype html><html><body style="margin:0;background:#0b0c10;font-family:Arial,sans-serif;color:#e5e7eb;">
  <div style="max-width:520px;margin:32px auto;background:#14161c;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:bold;color:#f59e0b;margin-bottom:16px;"><img src="${esc(brandIconUrl)}" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px;">AbsoluteCinema</div>
    <h2 style="margin:0 0 12px;color:#fff;">${title}</h2>
    <p style="line-height:1.6;margin:0 0 24px;">${body}</p>
    ${href ? `<a href="${esc(safeHttpUrl(href))}" style="display:inline-block;background:#f59e0b;color:#0b0c10;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none;">${cta}</a>` : ""}
  </div>
</body></html>`;
  }
}
