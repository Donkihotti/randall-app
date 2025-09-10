// src/lib/supabaseBrowser.js
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.warn("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for browser Supabase client");
}

let _supabase = null;

export function getBrowserSupabase() {
  if (!_supabase) {
    _supabase = createSupabaseClient(URL, KEY, {
      /* optional config here */
    });
  }
  return _supabase;
}

export default getBrowserSupabase;
