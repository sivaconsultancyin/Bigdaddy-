import bcrypt from 'bcryptjs';
import { getDatabaseClient } from '../db/postgres';

export async function bootstrapOwnerFromEnvironment(): Promise<void> {
  const username = process.env.OWNER_BOOTSTRAP_USERNAME?.trim();
  const email = process.env.OWNER_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_BOOTSTRAP_PASSWORD;
  if (!username || !email || !password) return;
  if (password.length < 12 || !email.includes('@')) {
    throw new Error('OWNER_BOOTSTRAP_USERNAME, valid OWNER_BOOTSTRAP_EMAIL and 12+ character OWNER_BOOTSTRAP_PASSWORD are required together');
  }

  const sql = getDatabaseClient();
  const existing = await sql.unsafe("SELECT u.id FROM public.users u JOIN public.role_assignments r ON r.user_id=u.id WHERE r.role='OWNER' LIMIT 1");
  if (existing[0]) {
    console.log('Owner bootstrap skipped: an Owner account already exists.');
    return;
  }

  await sql.begin(async (tx) => {
    const duplicate = await tx.unsafe('SELECT id FROM public.users WHERE lower(username)=lower($1) OR lower(email)=lower($2) LIMIT 1', [username, email]);
    if (duplicate[0]) throw new Error('Owner bootstrap identity already exists; resolve it before continuing.');
    const hash = await bcrypt.hash(password, 12);
    const rows = await tx.unsafe('INSERT INTO public.users(username,email,password_hash,parent_id) VALUES($1,$2,$3,NULL) RETURNING id', [username, email, hash]);
    const ownerId = rows[0].id as string;
    await tx.unsafe("INSERT INTO public.role_assignments(user_id,role,assigned_by) VALUES($1,'OWNER',NULL)", [ownerId]);
    await tx.unsafe('INSERT INTO public.user_profiles(user_id,display_name) VALUES($1,$2)', [ownerId, username]);
    await tx.unsafe("INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,details) VALUES($1,'OWNER_BOOTSTRAPPED','USER',$1,'{"source":"environment_bootstrap"}'::jsonb)", [ownerId]);
  });
  console.log('Owner bootstrap completed. Remove OWNER_BOOTSTRAP_PASSWORD from the service environment after confirming login.');
}
