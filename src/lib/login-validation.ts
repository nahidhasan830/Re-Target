import { z } from 'zod';

export const loginInput = z.object({
  phone: z.string().trim()
    .min(1, 'Enter your phone number.')
    .regex(/^[0-9]+$/, 'Use numbers only (0–9).')
    .length(11, 'Enter an 11-digit phone number.')
    .regex(/^01/, 'Your phone number must start with 01.'),
  password: z.string()
    .min(1, 'Enter your password.')
    .max(128, 'Use no more than 128 characters.')
    .refine((value) => value.trim().length > 0, 'Enter your password.'),
}).strict();

export type LoginErrors = Partial<Record<'phone' | 'password', string>>;

export function validateLogin(input: unknown) {
  const result = loginInput.safeParse(input);
  const errors: LoginErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if ((field === 'phone' || field === 'password') && !errors[field]) errors[field] = issue.message;
    }
  }
  return { result, errors };
}
