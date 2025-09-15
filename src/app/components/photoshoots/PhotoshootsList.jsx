"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FetchLoader from "../loaders/FetchLoader";

/**
 * PhotoshootsList (client)
 * - Fetches GET /api/photoshoots with credentials included (HttpOnly cookies)
 * - Shows loading / error states and list of photoshoots
 * - Debug logs extensively for troubleshooting
 */
export default function PhotoshootsList() {
  const [loading, setLoading] = useState(true);
  const [photoshoots, setPhotoshoots] = useState([]);
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function load() {
      console.log("[PhotoshootsList] load start");
      setLoading(true);
      setError(null);

      try {
        // Use credentials: 'include' so HttpOnly server cookies are sent
        const res = await fetch("/api/photoshoots", {
          method: "GET",
          credentials: "include", // IMPORTANT
          cache: "no-store",
        });

        console.log("[PhotoshootsList] raw response", { status: res.status, statusText: res.statusText });

        // Attempt to parse JSON safely (server sometimes returns HTML on error; catch parse errors)
        let json = null;
        try {
          json = await res.json();
        } catch (parseErr) {
          console.error("[PhotoshootsList] failed to parse JSON from /api/photoshoots", parseErr);
          // Try to capture response text for debugging
          const text = await res.text().catch(() => "(no body)");
          console.error("[PhotoshootsList] response text:", text);
          throw new Error("Invalid JSON response from server");
        }

        console.log("[PhotoshootsList] parsed JSON", json);

        if (!res.ok) {
          const msg = json?.error || `API error ${res.status}`;
          throw new Error(msg);
        }

        const items = Array.isArray(json.photoshoots) ? json.photoshoots : [];
        console.log("[PhotoshootsList] photoshoots count:", items.length);

        if (mounted) setPhotoshoots(items);
      } catch (err) {
        console.error("[PhotoshootsList] load error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
        console.log("[PhotoshootsList] load finished");
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
    <FetchLoader/>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600 mb-2">Error: {error}</div>
        <div className="text-xs text-gray-500">
          If this says "Unauthorized" ensure you are signed in and that client fetch uses <code>credentials: "include"</code>.
        </div>
      </div>
    );
  }

  if (!photoshoots.length) {
    return (
      <div className="p-6">
        <div>No photoshoots yet — create one to get started.</div>
        <div className="text-xs text-gray-500 mt-2">Tip: use the project or photoshoot creation modal to add one.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      {photoshoots.map((p) => (
        <div key={p.id} className="box-bg-normal p-4 rounded-lg shadow-sm border flex justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex items-baseline gap-3">
              <div className="text-lg font-medium">{p.name || "Untitled photoshoot"}</div>
              <div className="text-xs text-gray-500">· {p.status || "unknown"}</div>
            </div>
            {p.description && <div className="text-sm text-gray-600 mt-1">{p.description}</div>}
            <div className="text-xs text-gray-400 mt-2">Created: {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                console.log("[PhotoshootsList] open photoshoot", p.id);
                // Using client-side navigation; if your dashboard's server components need cookies immediately,
                // consider window.location.href to force full reload.
                router.push(`/photoshoot/${p.id}/dashboard`);
              }}
              className="button-normal-h-light"
            >
              Open
            </button>

            <Link
              href={`/api/photoshoots/${p.id}`}
              target="_blank"
              className="text-xs underline text-gray-600"
              onClick={() => console.log("[PhotoshootsList] open API debug", p.id)}
            >
              API (raw)
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
