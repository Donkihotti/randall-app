import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../../utils/supabase/server";

export async function GET() {
  const supabase = createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
