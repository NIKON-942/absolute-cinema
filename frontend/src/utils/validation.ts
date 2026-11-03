/** Client-side form validation helpers shared by the auth and profile forms. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** РГР2 FR-2: at least eight characters; bcrypt accepts up to 72 UTF-8 bytes. */

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidPassword(value: string): boolean {
  return [...value].length >= 8 && new TextEncoder().encode(value).length <= 72;
}
