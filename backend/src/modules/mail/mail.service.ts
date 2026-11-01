import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { AppConfig } from "../../config/configuration";

type Lang = "en" | "uk";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService<AppConfig, true>) {
    const smtp = config.get("smtp", { infer: true })!;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: false,
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

  sendWelcome(to: string, name: string, lang: Lang = "en"): void {
    const t =
      lang === "uk"
        ? {
            subject: "Ласкаво просимо до AbsoluteCinema",
            title: `Вітаємо, ${name}!`,
            body: "Ваш обліковий запис створено. Тисячі фільмів вже чекають на вас.",
            cta: "Почати перегляд",
          }
        : {
            subject: "Welcome to AbsoluteCinema",
            title: `Welcome, ${name}!`,
            body: "Your account has been created. Thousands of movies are waiting for you.",
            cta: "Start watching",
          };
    this.send(to, t.subject, this.layout(t.title, t.body, t.cta));
  }

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

  sendReceipt(
    to: string,
    details: {
      tier: string;
      period: string;
      amount: number;
      currency: string;
      endsAt: Date;
    },
    lang: Lang = "en",
  ): void {
    const t =
      lang === "uk"
        ? {
            subject: "Квитанція про оплату AbsoluteCinema",
            title: "Платіж отримано",
            body: `Підписку <b>${details.tier}</b> (${details.period === "monthly" ? "щомісячна" : "річна"}) активовано до ${details.endsAt.toLocaleDateString("uk-UA")}.`,
            cta: "Дивитися зараз",
          }
        : {
            subject: "AbsoluteCinema payment receipt",
            title: "Payment received",
            body: `Your <b>${details.tier}</b> subscription (${details.period}) is active until ${details.endsAt.toISOString().slice(0, 10)}. Charged: $${details.amount.toFixed(2)}.`,
            cta: "Watch now",
          };
    this.send(to, t.subject, this.layout(t.title, t.body, t.cta));
  }

  private layout(
    title: string,
    body: string,
    cta: string,
    href?: string,
  ): string {
    return `<!doctype html><html><body style="margin:0;background:#0b0c10;font-family:Arial,sans-serif;color:#e5e7eb;">
  <div style="max-width:520px;margin:32px auto;background:#14161c;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:bold;color:#f59e0b;margin-bottom:16px;">🎬 AbsoluteCinema</div>
    <h2 style="margin:0 0 12px;color:#fff;">${title}</h2>
    <p style="line-height:1.6;margin:0 0 24px;">${body}</p>
    ${href ? `<a href="${href}" style="display:inline-block;background:#f59e0b;color:#0b0c10;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none;">${cta}</a>` : ""}
  </div>
</body></html>`;
  }
}
