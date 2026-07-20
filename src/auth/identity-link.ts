export type IdentityProvider = 'shre-id';

type SupabaseAdminLike = {
  from(table: string): any;
  auth: {
    admin: {
      getUserById(id: string): Promise<{ data?: { user?: any | null }; error?: { message?: string } | null }>;
      listUsers(input?: { page?: number; perPage?: number }): Promise<{ data?: { users?: any[] }; error?: { message?: string } | null }>;
    };
  };
};

export type LinkedIdentity = {
  provider: IdentityProvider;
  subject: string;
  userId: string;
  email?: string;
  linkedBy: 'existing-link' | 'same-subject' | 'verified-email';
};

function verifiedEmail(claims: Record<string, unknown>): string | null {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) return null;
  if (claims.email_verified === false) return null;
  return email;
}

async function findAuthUserByEmail(supabase: SupabaseAdminLike, email: string): Promise<any | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Supabase auth user inventory failed: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === email);
    if (found) return found;
    if (users.length < 1000) return null;
  }
  throw new Error('Supabase auth user inventory exceeded 20,000 users; use paged offline sync');
}

export async function resolveLinkedIdentity(
  supabase: SupabaseAdminLike,
  provider: IdentityProvider,
  subject: string,
  claims: Record<string, unknown>,
): Promise<LinkedIdentity> {
  const { data: link, error: linkError } = await supabase
    .from('identity_links')
    .select('user_id,email')
    .eq('provider', provider)
    .eq('provider_subject', subject)
    .maybeSingle();
  if (linkError) throw new Error(`Identity link lookup failed: ${linkError.message}`);
  if (link?.user_id) return { provider, subject, userId: link.user_id, email: link.email ?? undefined, linkedBy: 'existing-link' };

  const { data: sameId } = await supabase.auth.admin.getUserById(subject);
  if (sameId?.user?.id) {
    await supabase.from('identity_links').upsert({
      provider,
      provider_subject: subject,
      user_id: sameId.user.id,
      email: sameId.user.email ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,provider_subject' });
    return { provider, subject, userId: sameId.user.id, email: sameId.user.email ?? undefined, linkedBy: 'same-subject' };
  }

  const email = verifiedEmail(claims);
  if (!email) throw new Error('OIDC subject is not linked and token has no verified email');
  const emailUser = await findAuthUserByEmail(supabase, email);
  if (!emailUser?.id) throw new Error('OIDC subject is not linked to an existing AROS user');
  await supabase.from('identity_links').upsert({
    provider,
    provider_subject: subject,
    user_id: emailUser.id,
    email,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,provider_subject' });
  return { provider, subject, userId: emailUser.id, email, linkedBy: 'verified-email' };
}

