import { createClient } from '@supabase/supabase-js';

// Server-side only — uses service role key, bypasses RLS.
// Never import this from a client component.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);
