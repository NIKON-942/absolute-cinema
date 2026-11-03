import type { Plugin } from 'vite';
export function privacyPage(): Plugin;
export function renderPrivacyDocument(policy: unknown, slug?: string): string;
