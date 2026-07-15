/** Browser-safe model metadata. Credentials are deliberately not part of this contract. */
export const DEFAULT_MODEL = {
  id: 'shre-70b',
  provider: 'aum',
  label: 'AUM (Local)',
  endpoint: 'http://127.0.0.1:5480/v1',
} as const;
