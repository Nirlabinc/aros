import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[AROS] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. " +
    "Ensure .env is at the monorepo root with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
