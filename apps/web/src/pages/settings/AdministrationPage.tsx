const COPY: Record<string, [string, string]> = {
  settings: ['Workspace settings', 'Configure locale, notifications, approvals, data retention, and security defaults.'],
  profile: ['Your profile', 'Manage your name, avatar, contact details, timezone, and personal preferences.'],
  users: ['Users & access', 'Invite teammates and assign workspace roles with least-privilege access.'],
  workspace: ['Manage workspace', 'Edit workspace identity, stores, default mappings, and ownership.'],
};

export function AdministrationPage({ section }: { section: string }) {
  const [title, description] = COPY[section] || COPY.settings;
  return <section className="setup-page"><header className="setup-header"><div><p className="setup-eyebrow">Administration</p><h1>{title}</h1><p>{description}</p></div><button className="setup-primary">Save changes</button></header>
    <div className="admin-grid"><article className="setup-panel"><h2>{section === 'users' ? 'Workspace members' : 'General'}</h2>
      {section === 'users' ? <><div className="member-row"><span className="avatar">NP</span><div><strong>Workspace owner</strong><small>Owner · Full access</small></div><span className="status-pill connected">Active</span></div><button className="setup-secondary">+ Invite user</button></> : <div className="connection-form"><label>Display name<input defaultValue={section === 'workspace' ? 'My Workspace' : 'Workspace owner'} /></label><label>Timezone<select defaultValue="America/New_York"><option>America/New_York</option><option>America/Chicago</option><option>America/Los_Angeles</option></select></label><label>Default store<select><option>All stores</option><option>Main Store</option></select></label></div>}
    </article><aside className="setup-panel"><h2>Security baseline</h2><p className="panel-copy">OAuth is preferred over API keys. Secrets are sealed in the Shreai vault and permissions are scoped by workspace, connection, store, capability, and action.</p><div className="test-success"><strong>✓ Protection active</strong><span>Approval gates enabled for write actions.</span></div></aside></div>
  </section>;
}
