import * as z from 'zod/mini';

export const localPhoneInput = z.string().check(z.trim(), z.regex(/^01[0-9]{9}$/, 'Enter an 11-digit phone number starting with 01.'));
const companyName = z.string().check(z.trim(), z.minLength(1, 'Enter your company name.'), z.maxLength(120, 'Use no more than 120 characters.'));
const password = z.string().check(z.minLength(10, 'Use at least 10 characters.'), z.maxLength(128, 'Use no more than 128 characters.'),
  z.refine((value) => value.trim().length > 0, 'Enter your password.'));
export const setupInput = z.strictObject({ companyName, password });
export const companyInput = z.strictObject({ action: z.literal('company'), companyName });
export const passwordInput = z.strictObject({
  action: z.literal('password'),
  currentPassword: z.string().check(z.minLength(1, 'Enter your current password.'), z.maxLength(128, 'Use no more than 128 characters.')),
  newPassword: password,
  confirmPassword: z.string().check(z.minLength(1, 'Confirm your new password.'), z.maxLength(128, 'Use no more than 128 characters.')),
}).check(
  z.refine((value) => value.newPassword === value.confirmPassword, { path: ['confirmPassword'], error: 'Passwords don’t match.' }),
  z.refine((value) => value.currentPassword !== value.newPassword, { path: ['newPassword'], error: 'Choose a different password.' }),
);
export type AccountErrors = Partial<Record<'companyName' | 'currentPassword' | 'newPassword' | 'confirmPassword', string>>;

export function validateAccountUpdate(input: Record<string, string>) {
  const result = input.action === 'company' ? companyInput.safeParse(input) : passwordInput.safeParse(input);
  const errors: AccountErrors = {};
  if (!result.success) for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof AccountErrors;
    if (['companyName', 'currentPassword', 'newPassword', 'confirmPassword'].includes(field) && !errors[field]) errors[field] = issue.message;
  }
  return { result, errors };
}
export type SetupErrors = Partial<Record<'companyName' | 'password', string>>;

export function validateNewPassword(value: string) {
  const result = password.safeParse(value);
  return { result, error: result.success ? undefined : result.error.issues[0]?.message };
}

export function validateSetup(input: unknown) {
  const result = setupInput.safeParse(input);
  const errors: SetupErrors = {};
  if (!result.success) for (const issue of result.error.issues) {
    const field = issue.path[0];
    if ((field === 'companyName' || field === 'password') && !errors[field]) errors[field] = issue.message;
  }
  return { result, errors };
}
