// src/app/api/auth/logout/route.js
import { NextResponse } from "next/server";

/**
 * POST /api/auth/logout
 * - Reads incoming Cookie header,
 * - Builds Set-Cookie headers to expire them,
 * - Returns JSON { ok: true, cleared: [names] }.
 *
 * Security notes:
 * - Use POST to reduce accidental CSRF. If you need extra CSRF protection, require a CSRF token.
 * - This endpoint expires all cookies the browser sends. It does not validate the user token by itself,
 *   but the cookie removal is idempotent and safe. You can optionally validate the request with
 *   a bearer token in Authorization header before clearing.
 */
export async function POST(request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[/api/auth/logout] incoming cookie header:", cookieHeader ? "[present]" : "[none]");

    // parse cookie names
    const cookieNames = cookieHeader
      .split(";")
      .map(c => c.split("=")[0].trim())
      .filter(Boolean);

    // Always include any cookie names you know your auth setup uses (optional)
    // e.g. cookieNames.push("my_custom_cookie_name");

    // Build headers: one Set-Cookie per cookie name to expire it.
    const headers = new Headers();

    // set an expired date in the past (UTC) to force deletion
    const expired = "Thu, 01 Jan 1970 00:00:00 GMT";

    // Recommended flags: Path=/, HttpOnly (if you want cookie removed on client, keep HttpOnly), Secure, SameSite=Lax
    // Because we're expiring cookies we replicate the secure flags (Secure only works on HTTPS).
    cookieNames.forEach((name) => {
      // append Set-Cookie header. Value empty + expired date
      // Note: we include Max-Age=0 as well for compatibility.
      const cookie = `${encodeURIComponent(name)}=; Path=/; Expires=${expired}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
      headers.append("Set-Cookie", cookie);
      console.log("[/api/auth/logout] expiring cookie:", name);
    });

    // If there were no cookies (nothing to clear), still respond OK
    if (cookieNames.length === 0) {
      // Optionally, still clear commonly used cookie names (if you know them).
      // Example: headers.append("Set-Cookie", `sb-access-token=; Path=/; Expires=${expired}; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    }

    const body = { ok: true, cleared: cookieNames };
    return NextResponse.json(body, { status: 200, headers });
  } catch (err) {
    console.error("[/api/auth/logout] error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
