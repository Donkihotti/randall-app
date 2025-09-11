// src/app/api/auth/whoami/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/** helper - parse cookie header into map */
function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const name = decodeURIComponent(pair.slice(0, idx).trim());
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[name] = val;
    acc[name.toLowerCase()] = val;
    return acc;
  }, {});
}

export async function GET(request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[/api/auth/whoami] cookieHeader present:", !!cookieHeader);
    console.log("[/api/auth/whoami] raw cookieHeader:", cookieHeader);

    const cookies = parseCookies(cookieHeader);
    console.log("[/api/auth/whoami] parsed cookie keys:", Object.keys(cookies));

    const accessToken = cookies["sb-access-token"] || cookies["sb-access-token".toLowerCase()];
    console.log("[/api/auth/whoami] accessToken present:", !!accessToken, accessToken ? `len=${accessToken.length}` : 0);

    if (!accessToken) {
      return NextResponse.json({ ok: true, authed: false, reason: "no_access_token_cookie" });
    }

    // validate token server-side
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) {
      console.warn("[/api/auth/whoami] supabase.auth.getUser error", error);
      return NextResponse.json({ ok: true, authed: false, reason: "invalid_token", details: String(error) });
    }

    console.log("[/api/auth/whoami] user id:", data?.user?.id);
    return NextResponse.json({ ok: true, authed: true, user: { id: data.user.id, email: data.user.email } });
  } catch (err) {
    console.error("[/api/auth/whoami] unexpected", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
