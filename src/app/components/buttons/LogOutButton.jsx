"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * LogoutButton
 * - signs out via Supabase client (clears client session)
 * - clears accessible cookies & localStorage keys
 * - calls POST /api/auth/logout with credentials: 'include' to clear server HttpOnly cookies
 * - redirects (or refreshes) on success
 */
export default function LogoutButton({ redirectTo = "/" }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // expire an individual cookie (client-side; cannot remove HttpOnly cookies)
  const expireCookie = (name) => {
    try {
      // set cookie with past date to expire it
      document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;`;
    } catch (e) {
      console.warn("[LogoutButton] expireCookie failed for", name, e);
    }
  };

  // clears all non-HttpOnly cookies visible to JS
  const clearAllDocumentCookies = () => {
    try {
      const raw = document.cookie || "";
      if (!raw) return [];
      const cookies = raw.split(";").map(c => c.split("=")[0].trim()).filter(Boolean);
      cookies.forEach(expireCookie);
      return cookies;
    } catch (e) {
      console.error("[LogoutButton] clearAllDocumentCookies error", e);
      return [];
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    console.log("[LogoutButton] logout start");

    try {
      // 1) Try supabase client signOut (clears local client session)
      const { error: signOutErr } = await supabase.auth.signOut();
      if (signOutErr) {
        console.warn("[LogoutButton] supabase.auth.signOut returned error", signOutErr);
      } else {
        console.log("[LogoutButton] supabase.auth.signOut success");
      }

      // 2) Clear localStorage keys your app uses (adjust keys as needed)
      try {
        // Common supabase client keys (may differ based on client version)
        const keysToRemove = [
          "sb:token", // examples — adjust for your app
          "supabase.auth.token",
          "supabase.auth.session",
        ];
        keysToRemove.forEach(k => {
          try { localStorage.removeItem(k); console.log("[LogoutButton] removed localStorage", k); } catch (e) {}
        });
      } catch (e) {
        console.warn("[LogoutButton] clearing localStorage failed", e);
      }

      // 3) Expire all accessible cookies in document.cookie (won't clear HttpOnly cookies)
      const clearedClientCookies = clearAllDocumentCookies();
      console.log("[LogoutButton] cleared client cookies:", clearedClientCookies);

      // 4) Call server endpoint to clear HttpOnly cookies (must be POST; include credentials)
      // The endpoint will read incoming cookies and set Set-Cookie headers to expire them.
      const resp = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include", // important: include cookie for server to know what to clear
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_logout" }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => null);
        console.warn("[LogoutButton] /api/auth/logout returned non-ok", resp.status, body);
      } else {
        const j = await resp.json().catch(() => null);
        console.log("[LogoutButton] /api/auth/logout response", j);
      }

      // 5) final: force a client-side refresh / redirect to clean UI
      // Option A: reload page
      // window.location.reload();
      // Option B: push to a public page
      router.push(redirectTo);
      console.log("[LogoutButton] logout finished, redirected to", redirectTo);
    } catch (err) {
      console.error("[LogoutButton] logout error", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="text-small font-semibold text-lighter px-2 hover:cursor-pointer"
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
