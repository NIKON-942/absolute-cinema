# Технології та системні вимоги

Оновлено 05.11.2026. Версії прочитані з lockfiles і конфігурації; це не перевірка останніх релізів або поточного npm audit.

## Вимоги DOCX

ТЗ 4.4–4.5 і РГР2 2.4: TypeScript ≥5.4, Node.js ≥18, PostgreSQL ≥14, VS Code ≥1.90; сервер Debian 12 / Ubuntu 22.04 LTS або новіший. РГР2 обирає React, NestJS та TypeORM. Нижня межа з ТЗ не гарантує сумісність поточного dependency tree: для цього checkout використовується Node 24.

| Ресурс | Мінімум за DOCX | Рекомендовано за DOCX |
|---|---|---|
| CPU | 4 ядра, ≥2,5 ГГц | 8 ядер, ≥3 ГГц |
| RAM | 8 ГБ | 16 ГБ |
| Диск | 500 ГБ NVMe SSD | 1 ТБ NVMe SSD |
| Мережа | 1 Гбіт/с | 10 Гбіт/с |

ТЗ згадує x86_64 або сумісну архітектуру. CI/deployment орієнтований на ARM64 Oracle A1; це інженерне рішення, а не підтвердження апаратних характеристик. Ресурси віддаленої VM тут не перевірялися.

Клієнт за ТЗ: Chrome 120+, Firefox 115 ESR+, Safari 16+, Edge 120+, HTML5/CSS3/ES2022, Full HD 1920×1080 з адаптацією для менших дисплеїв. РГР2 2.3 додатково згадує останні три major-версії Chrome/Firefox/Safari. Потрібні перевірки обох наборів критеріїв. Для 720p — стабільні ≥5 Мбіт/с.

## Фактичний стек

| Рівень | Версія/технологія | Джерело |
|---|---|---|
| Runtime | Node 24 | `.nvmrc`, Dockerfiles, CI |
| Мова | TypeScript 5.9.3 | обидва lockfiles |
| Frontend | React 19.3.1, React Router 7.18.5, Vite 8.3.5 | frontend lockfile |
| UI | Tailwind 3, Lucide React, власні компоненти | frontend manifest/components |
| HTTP / hashing | Axios, @noble/hashes у worker | frontend services/workers |
| Backend | NestJS 12.3.2, Express 5.3.0 | backend lockfile |
| Дані | TypeORM 0.3.31, pg, PostgreSQL 17 | backend lockfile, Compose |
| Авторизація | Passport JWT/Google, bcrypt 6 | backend dependencies |
| Платежі | Stripe SDK 23.1.0, mock режим | backend service/lockfile |
| Відео | Системні FFmpeg/ffprobe, прямі subprocess | `media-processing.ts`; fluent-ffmpeg не використовується |
| SMTP | Nodemailer 10.3.1 | backend lockfile |
| Dev inbox | Mailpit v1.33.0 | локальний Compose |
| Tracing | OpenTelemetry → OTLP HTTP; Jaeger 2.22.0 | main.ts, Compose |
| Web gateway | Caddy 2.11.7-alpine | frontend Dockerfile |
| CI/CD | GitHub Actions, GHCR, Docker Compose, SSH | workflows, deploy |

Backend engines дозволяє `>=22.15.0 <23 || >=24`, але весь проєкт слід запускати на узгодженій версії 24. FFmpeg потрібний для upload/перекодування, генерації демо й відеотестів; для читання каталогу він не потрібний.

Історію оновлень збережено в [dependency-review-2026-11.md](dependency-review-2026-11.md) та [dependency-upgrades.md](dependency-upgrades.md). Не переносіть датовані audit-результати на нинішню безпеку без нового audit.
