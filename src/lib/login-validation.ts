import * as z from 'zod/mini';

const phone = z.string().check(
  z.trim(),
  z.minLength(1, 'Enter your phone number.'),
  z.regex(/^[0-9]+$/, 'Use numbers only (0–9).'),
  z.length(11, 'Enter an 11-digit phone number.'),
  z.regex(/^01/, 'Your phone number must start with 01.'),
);

export const loginInput = z.strictObject({
  phone,
  password: z.string().check(
    z.minLength(1, 'Enter your password.'),
    z.maxLength(128, 'Use no more than 128 characters.'),
    z.refine((value) => value.trim().length > 0, 'Enter your password.'),
  ),
});

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

export function validateResetRequest(value: string) {
  const result = phone.safeParse(value);
  return { result, error: result.success ? undefined : result.error.issues[0]?.message };
}
