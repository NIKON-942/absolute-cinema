import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import policy from '@/content/privacy.json';
import terms from '@/content/terms.json';

export default function Privacy({ document = 'privacy' }: { document?: 'privacy' | 'terms' }) {
  const { lang } = useLanguage();
  const content = (document === 'privacy' ? policy : terms)[lang];
  const { contact } = policy;
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-cinema-accent hover:underline"><ArrowLeft size={16} aria-hidden="true" /> {content.home}</Link>
      <header className="mb-8 mt-5">
        <p className="text-sm font-semibold text-cinema-accent">AbsoluteCinema</p>
        <h1 className="mt-2 text-3xl font-extrabold text-cinema-strong sm:text-4xl">{content.title}</h1>
        <p className="mt-3 text-sm text-cinema-muted">{content.updatedLabel}: <time dateTime={contact.updated}>{new Intl.DateTimeFormat(lang === 'uk' ? 'uk-UA' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(contact.updated + 'T00:00:00Z'))}</time></p>
        <p className="mt-5 leading-relaxed text-cinema-soft">{content.intro}</p>
      </header>
      <nav aria-label={content.title} className="mb-8 grid gap-2 rounded-2xl border border-cinema-border bg-cinema-panel p-5 text-sm sm:grid-cols-2">
        {content.sections.map(section => <a key={section.id} href={`#${section.id}`} className="text-cinema-accent hover:underline">{section.title}</a>)}
      </nav>
      <div className="space-y-8">
        {content.sections.map(section => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-xl font-bold text-cinema-strong">{section.title}</h2>
            {section.paragraphs.map((paragraph, index) => <p key={index} className="mt-3 leading-relaxed text-cinema-soft">{paragraph}</p>)}
          </section>
        ))}
      </div>
      <section className="mt-10 rounded-2xl border border-cinema-border bg-cinema-panel p-5">
        <h2 className="text-lg font-bold text-cinema-strong">{content.contactTitle}</h2>
        <p className="mt-3 text-cinema-soft">{lang === 'uk' ? contact.name : contact.nameEn}</p>
        <a href={`mailto:${contact.email}`} className="mt-1 inline-block break-all font-semibold text-cinema-accent hover:underline">{contact.email}</a>
      </section>
    </article>
  );
}
