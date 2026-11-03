import { registerDecorator, ValidationOptions } from 'class-validator';

/** bcrypt truncates at 72 bytes, so reject longer input rather than alias passwords. */
export function IsPassword(options?: ValidationOptions): PropertyDecorator {
  return (target, property) => registerDecorator({
    name: 'isPassword', target: target.constructor, propertyName: String(property),
    options: { message: 'Password must contain at least 8 characters and at most 72 UTF-8 bytes', ...options },
    validator: { validate: (value: unknown) => typeof value === 'string'
      && [...value].length >= 8 && Buffer.byteLength(value, 'utf8') <= 72 },
  });
}
