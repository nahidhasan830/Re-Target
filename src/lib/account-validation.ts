import { z } from 'zod';

export const localPhoneInput = z.string().trim().regex(/^01[0-9]{9}$/, 'Enter an 11-digit phone number starting with 01.');
const companyName = z.string().trim().min(1, 'Enter your company name.').max(120, 'Use no more than 120 characters.');
const password = z.string().min(10, 'Use at least 10 characters.').max(128, 'Use no more than 128 characters.')
  .refine((value) => value.trim().length > 0, 'Enter your password.');
export const setupInput = z.object({ companyName, password }).strict();
export const companyInput = z.object({ action: z.literal('company'), companyName }).strict();
export const passwordInput = z.object({
  action: z.literal('password'),
  currentPassword: z.string().min(1, 'Enter your current password.').max(128, 'Use no more than 128 characters.'),
  newPassword: password,
  confirmPassword: z.string().min(1, 'Confirm your new password.').max(128, 'Use no more than 128 characters.'),
}).strict().refine((value) => value.newPassword === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords don’t match.' })
  .refine((value) => value.currentPassword !== value.newPassword, { path: ['newPassword'], message: 'Choose a different password.' });
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

export function validateSetup(input: unknown) {
  const result = setupInput.safeParse(input);
  const errors: SetupErrors = {};
  if (!result.success) for (const issue of result.error.issues) {
    const field = issue.path[0];
    if ((field === 'companyName' || field === 'password') && !errors[field]) errors[field] = issue.message;
  }
  return { result, errors };
}
