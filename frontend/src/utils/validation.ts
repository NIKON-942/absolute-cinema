/** Client-side form validation helpers shared by the auth and profile forms. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Password rule (FR-2): min 8 chars, at least one letter and one non-letter character (digit or special). */
const PASSWORD_RE = /^(?=.*[A-Za-zА-Яа-яІіЇїЄєҐґ])(?=.*[^A-Za-zА-Яа-яІіЇїЄєҐґ]).{8,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidPassword(value: string): boolean {
  return PASSWORD_RE.test(value);
}
