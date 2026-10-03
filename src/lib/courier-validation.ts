import { z } from 'zod';

export const courierProviders = ['pathao', 'steadfast'] as const;
export type CourierProvider = typeof courierProviders[number];
export type CourierField = { name: string; label: string; secret: boolean; type?: 'email'; maximum: number };
export const courierFields: Record<CourierProvider, CourierField[]> = {
  pathao: [
    { name: 'username', label: 'Merchant email', secret: false, type: 'email', maximum: 254 },
    { name: 'password', label: 'Merchant password', secret: true, maximum: 256 },
  ],
  steadfast: [
    { name: 'username', label: 'Merchant email', secret: false, type: 'email', maximum: 254 },
    { name: 'password', label: 'Merchant password', secret: true, maximum: 256 },
  ],
};
export const courierNames = { pathao: 'Pathao', steadfast: 'Steadfast' };
export type CourierValues = Record<string, string>;
export type CourierErrors = Record<string, string>;

export function validateCourier(provider: CourierProvider, values: CourierValues, saved = false) {
  const errors: CourierErrors = {};
  const data: CourierValues = {};
  for (const field of courierFields[provider]) {
    const value = field.name === 'password' ? values[field.name] ?? '' : (values[field.name] ?? '').trim();
    data[field.name] = value;
    if (!value) {
      if (!(saved && field.secret)) errors[field.name] = `Enter ${field.label.toLowerCase()}.`;
    } else if (value.length > field.maximum) {
      errors[field.name] = `Use ${field.maximum} characters or fewer.`;
    } else if (field.type === 'email' && !z.email().safeParse(value).success) {
      errors[field.name] = 'Enter a valid merchant email.';
    } else if (field.name !== 'password' && /\s/.test(value)) {
      errors[field.name] = `${field.label} cannot contain spaces.`;
    }
  }
  return { data, errors, valid: !Object.keys(errors).length };
}
