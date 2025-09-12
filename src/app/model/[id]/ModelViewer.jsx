// src/app/model/[id]/ModelViewer.jsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/**
 * ModelViewer client component (patched for automatic refresh)
 * - Accepts id (string or object)
 * - Fetches /api/models/{id} with credentials included (HttpOnly cookie auth)
 * - Displays assets and "Open" links
 * - Schedules an automatic re-fetch before signed URL expiry
 */

const REFRESH_BUFFER_SEC = 60; // refresh 60s before expiry; adjust as needed

export default function ModelViewer({ id }) {
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const refreshTimerRef = useRef(null);
  const fetchInProgressRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
    };
  }, []);

  function clearRefreshTimer() {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  const scheduleRefresh = (assetsArray) => {
    clearRefreshTimer();
    const unixNow = Math.floor(Date.now() / 1000);
    const expiries = (assetsArray || [])
      .map(a => a.expires_at)
      .filter(Boolean);

    if (!expiries.length) {
      console.log("[ModelViewer] no expiry info found, not scheduling refresh");
      return;
    }

    const earliest = Math.min(...expiries);
    const refreshAt = earliest - REFRESH_BUFFER_SEC;
    const delayMs = Math.max(0, (refreshAt - unixNow) * 1000);

    if (delayMs <= 0) {
      console.log("[ModelViewer] earliest expiry is soon or passed — scheduling immediate refresh");
      refreshTimerRef.current = setTimeout(() => fetchModel(true), 200);
    } else {
      console.log("[ModelViewer] scheduling refresh in ms:", delayMs, { earliest, refreshAt });
      refreshTimerRef.current = setTimeout(() => fetchModel(true), delayMs);
    }
  };

  const fetchModel = useCallback(async (force = false) => {
    // resolve id shape
    let resolvedId = id;
    if (typeof id === "object" && id !== null) {
      resolvedId = id.id ?? id._id ?? id.modelId ?? null;
    }

    if (!resolvedId || typeof resolvedId !== "string") {
      setError("Missing or invalid model id");
      setLoading(false);
      return;
    }

    if (fetchInProgressRef.current && !force) {
      console.log("[ModelViewer] fetch already in progress; skipping");
      return;
    }

    fetchInProgressRef.current = true;
    setLoading(true);
    setError(null);

    try {
      console.log("[ModelViewer] fetchModel start", { resolvedId, force });
      const url = `/api/models/${encodeURIComponent(resolvedId)}`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "include", // ensure HttpOnly cookies are included
        cache: "no-store",
      });

      console.log("[ModelViewer] fetch raw response", { status: res.status, statusText: res.statusText });

      const json = await res.json().catch((e) => {
        console.error("[ModelViewer] failed to parse JSON", e);
        throw e;
      });

      console.log("[ModelViewer] response JSON", json);

      if (!res.ok) {
        const msg = json?.error || `API error ${res.status}`;
        throw new Error(msg);
      }

      const returnedAssets = Array.isArray(json.assets) ? json.assets : [];
      console.log("[ModelViewer] assets count:", returnedAssets.length);

      const normalized = returnedAssets.map((a) => ({
        id: a.id,
        url: a.url ?? null,
        meta: a.meta ?? {},
        expires_in: typeof a.expires_in === "number" ? a.expires_in : null,
        expires_at: typeof a.expires_at === "number" ? a.expires_at : (typeof a.expires_in === "number" ? Math.floor(Date.now() / 1000) + a.expires_in : null),
      }));

      if (mountedRef.current) {
        setAssets(normalized);
        // schedule refresh according to returned expiries
        scheduleRefresh(normalized);
      }
    } catch (err) {
      console.error("[ModelViewer] fetchModel error", err);
      if (mountedRef.current) setError(err.message || String(err));
    } finally {
      fetchInProgressRef.current = false;
      if (mountedRef.current) setLoading(false);
      console.log("[ModelViewer] fetchModel finished");
    }
  }, [id]);

  useEffect(() => {
    fetchModel();
    return () => clearRefreshTimer();
  }, [id, fetchModel]);

  // when an image fails to load (likely expired URL), try to refresh signed urls
  const handleImageError = async (asset) => {
    console.warn("[ModelViewer] image failed to load for", asset.id, "attempting immediate refresh");
    // small debounce: only force if not already fetching
    await fetchModel(true);
  };

  if (loading) return <div className="p-6 w-full h-full flex items-center justify-center">Loading assets…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!assets.length) return <div className="p-6">No assets in this collection.</div>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full h-full">
      {assets.map((a) => (
        <div key={a.id} className="box-bg-normal overflow-hidden">
          {a.url ? (
            <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
              <img
                src={a.url}
                alt={a.meta?.filename || a.id}
                className="w-full h-full object-cover"
                onError={(e) => {
                  console.error("[ModelViewer] image failed to load", { assetId: a.id, url: a.url, err: e });
                  e.currentTarget.style.objectFit = "contain";
                  handleImageError(a);
                }}
              />
            </div>
          ) : (
            <div className="p-4 h-48 flex items-center justify-center">
              <div className="text-sm text-gray-500">No URL available for asset {a.id}</div>
            </div>
          )}

          <div className="p-3">
            <div className="mt-3 flex gap-2">
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs inline-block px-2 py-1 border rounded text-white hover:bg-gray-100"
                  onClick={() => console.log("[ModelViewer] user clicked Open asset", a.id)}
                >
                  Open
                </a>
              ) : (
                <button
                  className="text-xs px-2 py-1 border rounded text-gray-400 cursor-not-allowed"
                  title="No URL available"
                >
                  Open
                </button>
              )}

              <button
                className="text-xs px-2 py-1 border rounded text-white hover:bg-gray-100"
                onClick={() => {
                  console.log("[ModelViewer] debug: copy asset url to clipboard", a.id, a.url);
                  if (a.url) navigator.clipboard?.writeText(a.url).then(() => {
                    console.log("[ModelViewer] copied url for", a.id);
                    alert("Asset URL copied to clipboard (debug)");
                  }).catch((e) => {
                    console.warn("[ModelViewer] failed to copy url", e);
                  });
                }}
              >
                Copy URL
              </button>

              <button
                className="text-xs px-2 py-1 border rounded text-white hover:bg-gray-100"
                onClick={() => {
                  console.log("[ModelViewer] manual refresh requested");
                  fetchModel(true);
                }}
              >
                Refresh URLs
              </button>
            </div>

            <div className="text-xs text-gray-400 mt-2">
              {a.expires_at ? `Expires: ${new Date(a.expires_at * 1000).toLocaleString()}` : "No expiry info"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
