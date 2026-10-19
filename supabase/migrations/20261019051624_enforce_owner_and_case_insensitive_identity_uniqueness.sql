-- Enforce one Owner account and case-insensitive login identity uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_single_owner_uidx
  ON public.role_assignments (role) WHERE role = 'OWNER';
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON public.users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON public.users (lower(email));
