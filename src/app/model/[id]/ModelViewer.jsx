// src/app/model/[id]/ModelViewer.jsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * ModelViewer
 * - Fetches collection metadata from /api/models/:id using Authorization header
 * - Server returns signed URLs for assets (short lived). We store them in memory.
 * - Provides a refresh button to re-create signed URLs server-side.
 *
 * NOTE: Do NOT log full tokens in production. This component logs token length only.
 */
export default function ModelViewer({ id }) {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null); // when signed URLs were fetched

  // Normalize incoming id prop (support both string and accidental object)
  const resolveId = (raw) => {
    if (!raw) return null;
    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && raw !== null) {
      return raw.id ?? raw._id ?? raw.modelId ?? null;
    }
    return null;
  };

  const resolvedId = resolveId(id);

  const fetchModel = useCallback(async (opts = { force: false }) => {
    if (!resolvedId) {
      console.error("[ModelViewer] invalid model id; aborting fetch", { id });
      setError("Missing or invalid model id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("[ModelViewer] fetchModel start", { resolvedId, force: opts.force });

      // get session token from supabase client
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      console.log("[ModelViewer] supabase.auth.getSession ->", { sessionData, sessionErr });

      const accessToken = sessionData?.session?.access_token;
      console.log("[ModelViewer] access token present:", !!accessToken, "length:", accessToken ? accessToken.length : 0);

      if (!accessToken) {
        // fallback: maybe user is signed in via cookie-based auth; if so you could use credentials: 'include'
        // but recommended: use bearer token.
        throw new Error("User not signed in (no access token)");
      }

      const url = `/api/models/${encodeURIComponent(resolvedId)}`;
      console.log("[ModelViewer] fetching API route", url);

      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      console.log("[ModelViewer] raw response", { status: res.status, statusText: res.statusText });

      // parse JSON safely
      const json = await res.json().catch((e) => {
        console.error("[ModelViewer] failed to parse json", e);
        throw e;
      });

      console.log("[ModelViewer] json body", json);

      if (!res.ok) {
        // api returns helpful error messages (Not found / Forbidden / Unauthorized)
        const msg = json?.error || `API returned ${res.status}`;
        throw new Error(msg);
      }

      const returnedAssets = Array.isArray(json.assets) ? json.assets : [];
      console.log("[ModelViewer] assets count", returnedAssets.length, returnedAssets);

      // store in memory
      setAssets(returnedAssets);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      console.error("[ModelViewer] fetchModel error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      console.log("[ModelViewer] fetchModel finished");
    }
  }, [resolvedId, id]);

  // initial load
  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  // helper: manually refresh signed urls
  const handleRefresh = async () => {
    console.log("[ModelViewer] manual refresh clicked");
    await fetchModel({ force: true });
  };

  // render
  if (loading) return <div className="p-6">Loading collection…</div>;
  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600">Error: {error}</p>
        <details className="mt-2 text-sm text-gray-500">
          <summary>Debug info</summary>
          <pre className="whitespace-pre-wrap">{JSON.stringify({ resolvedId, fetchedAt }, null, 2)}</pre>
        </details>
      </div>
    );
  }

  if (!assets.length) {
    return (
      <div className="p-6">
        <div className="mb-3">No assets in this collection.</div>
        <div className="text-sm text-gray-500">Collection ID: {resolvedId}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">Signed URLs fetched: {fetchedAt ? new Date(fetchedAt).toLocaleString() : "—"}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="px-3 py-1 bg-white border rounded text-sm hover:bg-gray-100"
          >
            Refresh signed URLs
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {assets.map((a) => (
          <div key={a.id} className="bg-white rounded-lg shadow-sm overflow-hidden border">
            {a.url ? (
              <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
                <img
                  src={a.url}
                  alt={a.meta?.filename || a.id}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error("[ModelViewer] image failed to load", { assetId: a.id, url: a.url, err: e });
                    e.currentTarget.style.objectFit = "contain";
                  }}
                />
              </div>
            ) : (
              <div className="p-4">No URL available for asset {a.id}</div>
            )}

            <div className="p-3">
              <div className="text-sm font-medium">{a.meta?.filename || a.id}</div>
              <div className="text-xs text-gray-500 mt-1">{a.meta?.description || a.meta?.type || "Asset"}</div>
              <div className="mt-3">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs inline-block px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                  onClick={() => console.log("[ModelViewer] user clicked open asset", a.id)}
                >
                  Open
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
