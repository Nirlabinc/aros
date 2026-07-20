select current_database() as db, current_user as user, version() like 'PostgreSQL%' as postgres_ok;

select to_regclass('public.identity_links') is not null as identity_links_exists;

select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tenant_members'
    and column_name = 'experience_grants'
) as experience_grants_exists;

select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'oidc_rp_sessions'
    and column_name = 'user_id'
) as oidc_session_user_id_exists;

select to_regclass('public.workspace_experience_settings') is not null as workspace_experience_settings_exists;
select to_regclass('public.user_experience_preferences') is not null as user_experience_preferences_exists;
