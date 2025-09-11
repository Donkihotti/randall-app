// src/app/api/auth/session/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY; // NOT used here
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export async function GET(request) {
  try {
    // Read our HttpOnly cookie from request headers
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(cookieHeader.split(";").map(c => {
      const [k, ...v] = c.split("=");
      return [k?.trim(), v?.join("=")];
    }).filter(Boolean));

    const accessToken = cookies["sb-access-token"] || cookies["sb-access-token".toLowerCase()];

    if (!accessToken) {
      return NextResponse.json({ ok: true, session: null });
    }

    // validate token server-side by asking Supabase
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) {
      console.warn("[/api/auth/session] supabase.auth.getUser error", error);
      return NextResponse.json({ ok: true, session: null });
    }

    return NextResponse.json({ ok: true, session: { user: data?.user } });
  } catch (err) {
    console.error("[/api/auth/session] error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
