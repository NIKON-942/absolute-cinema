import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { resolveMediaUrl } from '@/utils/url';

export function Navbar() {
  const { t } = useLanguage();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get('search') ?? '');
  const debouncedSearch = useDebounce(search, 500);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // navigate to catalog as the user types in the navbar search
  useEffect(() => {
    const trimmed = debouncedSearch.trim();
    if (trimmed.length < 2) return;
    const params = new URLSearchParams({ search: trimmed });
    if (location.pathname !== '/catalog' || location.search !== `?${params.toString()}`) {
      navigate(`/catalog?${params.toString()}`);
    }
  }, [debouncedSearch, navigate, location.pathname, location.search]);

  // close mobile menu / user dropdown on navigation
  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [location.pathname, location.search]);

  // close user dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-semibold transition ${
      isActive ? 'bg-cinema-card text-cinema-accent' : 'text-cinema-soft hover:bg-cinema-card/60 hover:text-cinema-text'
    }`;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = search.trim();
    navigate(trimmed ? `/catalog?search=${encodeURIComponent(trimmed)}` : '/catalog');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-cinema-border bg-cinema-black/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-5">
        {/* logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cinema-amber to-cinema-red font-black text-cinema-ink">
            A
          </span>
          <span className="hidden text-lg font-extrabold tracking-tight text-cinema-text sm:block">
            Absolute<span className="text-cinema-accent">Cinema</span>
          </span>
        </Link>

        {/* desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          <NavLink to="/" end className={navLinkClass}>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/catalog" className={navLinkClass}>
            {t('nav.catalog')}
          </NavLink>
          <NavLink to="/plans" className={navLinkClass}>
            {t('nav.plans')}
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={navLinkClass}>
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>

        {/* search */}
        <form onSubmit={submitSearch} className="ml-auto hidden min-w-0 flex-1 max-w-sm lg:block" role="search">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cinema-muted"
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('nav.searchPlaceholder')}
              aria-label={t('nav.search')}
              className="w-full rounded-lg border border-cinema-border bg-cinema-panel py-2 pl-9 pr-3 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:ml-0">
          <LanguageSwitcher />
          <ThemeSwitcher />

          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-cinema-border bg-cinema-panel px-2 py-1.5 transition hover:border-cinema-amber/50"
                aria-haspopup="menu"
                aria-expanded={userOpen}
              >
                {user.avatarUrl ? (
                  <img src={resolveMediaUrl(user.avatarUrl)} alt={user.name} className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-cinema-amber to-cinema-red text-sm font-bold text-cinema-ink">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[110px] truncate text-sm font-semibold text-cinema-text sm:block">
                  {user.name}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={`hidden text-cinema-muted transition sm:block ${userOpen ? 'rotate-180' : ''}`}>
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" />
                </svg>
              </button>
              {userOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 animate-fadeIn overflow-hidden rounded-xl border border-cinema-border bg-cinema-panel shadow-card" role="menu">
                  <div className="border-b border-cinema-border px-4 py-3">
                    <p className="truncate text-sm font-semibold text-cinema-text">{user.name}</p>
                    <p className="truncate text-xs text-cinema-muted">{user.email}</p>
                    <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      user.hasActiveSubscription ? 'bg-cinema-success-surface/60 text-cinema-success' : 'bg-cinema-card text-cinema-muted'
                    }`}>
                      {user.hasActiveSubscription ? t('subscription.active') : t('subscription.none')}
                    </span>
                  </div>
                  <Link to="/profile" className="block px-4 py-2.5 text-sm text-cinema-soft transition hover:bg-cinema-card">{t('nav.profile')}</Link>
                  <Link to="/plans" className="block px-4 py-2.5 text-sm text-cinema-soft transition hover:bg-cinema-card">{t('nav.plans')}</Link>
                  {isAdmin && (
                    <Link to="/admin" className="block px-4 py-2.5 text-sm text-cinema-soft transition hover:bg-cinema-card">{t('nav.admin')}</Link>
                  )}
                  <button
                    type="button"
                    onClick={() => { logout(); navigate('/'); }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-cinema-red transition hover:bg-cinema-card"
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-cinema-soft transition hover:text-cinema-accent">
                {t('nav.login')}
              </Link>
              <Link to="/register" className="rounded-lg bg-cinema-amber px-3 py-2 text-sm font-bold text-cinema-ink transition hover:shadow-glow">
                {t('nav.register')}
              </Link>
            </div>
          )}

          {/* mobile hamburger */}
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-cinema-border bg-cinema-panel p-2 text-cinema-soft lg:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('nav.menu')}
            aria-expanded={menuOpen}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {menuOpen ? <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /> : <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />}
            </svg>
          </button>
        </div>
      </div>

      {/* mobile menu */}
      {menuOpen && (
        <div className="animate-fadeIn border-t border-cinema-border bg-cinema-black px-4 pb-4 pt-2 lg:hidden">
          <form onSubmit={submitSearch} className="relative mb-3" role="search">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('nav.searchPlaceholder')}
              aria-label={t('nav.search')}
              className="w-full rounded-lg border border-cinema-border bg-cinema-panel py-2 px-3 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none"
            />
          </form>
          <nav className="flex flex-col gap-1">
            <NavLink to="/" end className={navLinkClass}>{t('nav.home')}</NavLink>
            <NavLink to="/catalog" className={navLinkClass}>{t('nav.catalog')}</NavLink>
            <NavLink to="/plans" className={navLinkClass}>{t('nav.plans')}</NavLink>
            {isAdmin && <NavLink to="/admin" className={navLinkClass}>{t('nav.admin')}</NavLink>}
            {user && <NavLink to="/profile" className={navLinkClass}>{t('nav.profile')}</NavLink>}
            {!user && (
              <div className="mt-2 flex gap-2">
                <Link to="/login" className="flex-1 rounded-lg border border-cinema-border px-3 py-2 text-center text-sm font-semibold text-cinema-soft">
                  {t('nav.login')}
                </Link>
                <Link to="/register" className="flex-1 rounded-lg bg-cinema-amber px-3 py-2 text-center text-sm font-bold text-cinema-ink">
                  {t('nav.register')}
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
