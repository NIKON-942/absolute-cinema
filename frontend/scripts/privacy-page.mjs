import { readFileSync } from 'node:fs';
const documentFiles = {
  privacy: new URL('../src/content/privacy.json', import.meta.url),
  terms: new URL('../src/content/terms.json', import.meta.url),
};
const readDocument = name => ({ ...JSON.parse(readFileSync(documentFiles[name], 'utf8')), contact: JSON.parse(readFileSync(documentFiles.privacy, 'utf8')).contact });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Public, script-free HTML for direct links and OAuth reviewers; same content as React. */
export function renderPrivacyDocument(policy, slug = 'privacy') {
  const c = policy.contact;
  const sections = ['uk', 'en'].map(lang => {
    const text = policy[lang];
    return '<article lang="' + lang + '" id="' + lang + '"><header><p class="brand">AbsoluteCinema</p><h1>' + escape(text.title) + '</h1><p class="muted">' + escape(text.updatedLabel) + ': <time datetime="' + escape(c.updated) + '">' + escape(c.updated) + '</time></p><p>' + escape(text.intro) + '</p></header>'
      + text.sections.map(section => '<section id="' + lang + '-' + escape(section.id) + '"><h2>' + escape(section.title) + '</h2>' + section.paragraphs.map(p => '<p>' + escape(p) + '</p>').join('') + '</section>').join('')
      + '<section class="contact"><h2>' + escape(text.contactTitle) + '</h2><p>' + escape(lang === 'uk' ? c.name : c.nameEn) + '<br><a href="mailto:' + escape(c.email) + '">' + escape(c.email) + '</a></p></section></article>';
  }).join('');
  return '<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="AbsoluteCinema: public policies and project contact."><title>AbsoluteCinema — ' + escape(policy.en.title) + ' / ' + escape(policy.uk.title) + '</title><link rel="icon" href="/brand/frog-head.png"><link rel="canonical" href="' + escape(c.site) + '/' + escape(slug) + '"><style>'
    + ':root{color-scheme:light dark;--bg:#f7f4ed;--panel:#fff;--text:#20242b;--soft:#4b5058;--accent:#8a5900;--border:#d5cfc3}@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#191d25;--text:#f4f3ef;--soft:#cfd2d7;--accent:#f2b84b;--border:#313742}}*{box-sizing:border-box}html{scroll-padding-top:1.5rem}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,sans-serif}main{max-width:800px;margin:auto;padding:28px 20px 60px}nav{display:flex;gap:20px;flex-wrap:wrap;padding-bottom:20px;border-bottom:1px solid var(--border)}a{color:var(--accent);overflow-wrap:anywhere}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}article{padding-top:28px}article+article{margin-top:52px;border-top:1px solid var(--border)}h1{font-size:clamp(28px,5vw,40px);line-height:1.2;margin:8px 0 16px}h2{font-size:21px;line-height:1.4;margin:28px 0 12px}p{color:var(--soft);margin:12px 0}.brand{font-weight:800;color:var(--accent)}.muted{font-size:14px}.contact{margin-top:32px;padding:4px 22px 16px;border:1px solid var(--border);border-radius:16px;background:var(--panel)}</style></head><body><main><nav aria-label="Навігація / Navigation"><a href="/">← AbsoluteCinema</a><a href="#uk" lang="uk">Українська</a><a href="#en" lang="en">English</a></nav>' + sections + '</main></body></html>';
}

export function privacyPage() {
  return {
    name: 'absolute-cinema-public-privacy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const name = path?.replace(/^\//, '').replace(/\/$/, '');
        if (!['GET','HEAD'].includes(req.method ?? '') || !Object.hasOwn(documentFiles, name ?? '')) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : renderPrivacyDocument(readDocument(name), name));
      });
    },
    generateBundle() {
      for (const name of Object.keys(documentFiles)) {
        this.emitFile({ type: 'asset', fileName: name + '/index.html', source: renderPrivacyDocument(readDocument(name), name) });
      }
    },
  };
}
