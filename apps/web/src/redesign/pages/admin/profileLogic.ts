// Pure validation for the Profile page. Framework-free.

export function passwordIssue(password: string, confirm: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Use letters and at least one number.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export function displayNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty.';
  if (trimmed.length > 80) return 'Name must be 80 characters or fewer.';
  return null;
}
