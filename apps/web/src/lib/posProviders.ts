/**
 * POS / back-office providers — the single source of truth for BOTH connect
 * surfaces (the /connect page and the AppShell ConnectWizard), which drifted
 * as separate copies (docs/journeys/WALK-FINDINGS.md, "two divergent connect
 * UIs"). `id` and field keys are the server wire contract
 * (tenant_connectors.type + validateConnectorInput in src/server.ts).
 * Every field carries a one-line hint per the journey gate: "each field
 * explained in one line" — knowledge Ramesh must already have trends to zero.
 */
export interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  secret?: boolean;
  optional?: boolean;
}

export interface ProviderDef {
  /** Wire type — stored as tenant_connectors.type; NOT a display id. */
  id: 'rapidrms-api' | 'verifone-commander' | 'azure-db';
  /** Formal card label ("RapidRMS POS") — /connect page. */
  label: string;
  /** Short display name ("RapidRMS") — wizard cards, CTAs, toasts. */
  shortName: string;
  mark: string;
  tag?: string;
  /** 'api' = cloud-testable over HTTPS; 'tunnel' = on-site device, a cloud
   * connection test may legitimately be unable to confirm it. */
  kind: 'api' | 'tunnel';
  tagline: string;
  /** Wizard step-2 intro sentence. */
  blurb: string;
  /** Register-focused wizard shows POS devices only. */
  wizard: boolean;
  fields: ProviderField[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'rapidrms-api',
    label: 'RapidRMS POS',
    shortName: 'RapidRMS',
    mark: 'RMS',
    tag: 'Recommended',
    kind: 'api',
    tagline: 'Cloud POS — sales, inventory, pricing, promotions',
    blurb: 'Sign in with your RapidRMS account. AROS connects over HTTPS for read access to live sales, inventory, and the price book — no on-site hardware needed.',
    wizard: true,
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Your RapidRMS client ID', hint: 'Identifies your store to RapidRMS — it’s in your RapidRMS back office, or ask RapidRMS support for it' },
      { key: 'email', label: 'Account Email', placeholder: 'you@yourstore.com', secret: true, hint: 'The email you use to sign in to RapidRMS' },
      { key: 'password', label: 'Password', placeholder: 'RapidRMS password', secret: true, hint: 'Your RapidRMS sign-in password' },
    ],
  },
  {
    id: 'verifone-commander',
    label: 'Verifone Commander',
    shortName: 'Verifone Commander',
    mark: 'VF',
    kind: 'tunnel',
    tagline: 'On-site Commander — fuel + c-store transaction data',
    blurb: 'Enter the Commander’s LAN address and its CGI service credentials. Traffic stays on an encrypted tunnel to the site controller — nothing is exposed publicly.',
    wizard: true,
    fields: [
      { key: 'commanderIp', label: 'Commander IP', placeholder: '192.168.31.11', hint: 'The Commander’s address on your store network — your POS installer set this up' },
      { key: 'username', label: 'CGI Username', placeholder: 'Commander username', hint: 'The CGI user configured on the Commander' },
      { key: 'password', label: 'Password', placeholder: 'Commander password', secret: true, hint: 'That user’s password' },
    ],
  },
  {
    id: 'azure-db',
    label: 'Azure SQL Database',
    shortName: 'Azure SQL',
    mark: 'AZ',
    kind: 'api',
    tagline: 'Direct database access to your back-office data',
    blurb: 'Connect AROS directly to your back-office SQL database for read access.',
    wizard: false,
    fields: [
      { key: 'server', label: 'Server', placeholder: 'yourserver.database.windows.net', hint: 'Your database server address — ends in database.windows.net' },
      { key: 'database', label: 'Database', placeholder: 'Database name' },
      { key: 'username', label: 'Username', placeholder: 'SQL username' },
      { key: 'port', label: 'Port', placeholder: '1433', optional: true },
      { key: 'password', label: 'Password', placeholder: 'SQL password', secret: true },
    ],
  },
];

export const WIZARD_PROVIDERS = PROVIDERS.filter((p) => p.wizard);

export type ProviderId = ProviderDef['id'];
