"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import FetchLoader from "@/app/components/loaders/FetchLoader";
import toast from "react-hot-toast";

/**
 * PhotoshootDashboardClient - single source-of-truth for photoshoot page
 * props: id (string)
 */
export default function PhotoshootDashboardClient({ id }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true); // initial load
  const [refreshing, setRefreshing] = useState(false); // periodic refresh indicator (no flashy loader)
  const [photoshoot, setPhotoshoot] = useState(null);
  const [assets, setAssets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);

  const pollRef = useRef(null);
  const signedRefreshRef = useRef(null);
  const abortRef = useRef(null);

  // visibilityRef: safe default 'visible' (no document access during SSR).
  // We'll assign the real visibility value inside useEffect on the client.
  const visibilityRef = useRef("visible");

  // Helper: fetch /api/photoshoots/{id}; if {opts.initial} don't stifle loading; if periodic, setRefreshing
  const fetchData = useCallback(
    async (opts = { initial: false }) => {
      if (!id) return;
      // Cancel any previous fetch
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (e) {}
        abortRef.current = null;
      }
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      if (opts.initial) {
        setLoading(true);
        setError(null);
      } else {
        // periodic refresh: do not flip the main loader; show a subtle "refreshing" state if you want
        setRefreshing(true);
      }

      try {
        const res = await fetch(`/api/photoshoots/${encodeURIComponent(id)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal,
        });

        // parse safely
        let json = null;
        try {
          json = await res.json();
        } catch (parseErr) {
          const text = await res.text().catch(() => "(no body)");
          throw new Error("Invalid JSON from server: " + text);
        }

        if (!res.ok) {
          throw new Error(json?.error || `API ${res.status}`);
        }

        // Do minimal updates to avoid flashing: only update changed pieces
        const newPhotoshoot = json.photoshoot ?? null;
        const newAssets = Array.isArray(json.assets) ? json.assets : [];
        const newJobs = Array.isArray(json.jobs) ? json.jobs : [];

        setPhotoshoot((prev) => {
          if (!prev) return newPhotoshoot;
          const prevKey = `${prev.id}|${prev.status}|${prev.name}|${prev.updated_at}`;
          const nextKey = `${newPhotoshoot?.id}|${newPhotoshoot?.status}|${newPhotoshoot?.name}|${newPhotoshoot?.updated_at}`;
          if (prevKey !== nextKey) return newPhotoshoot;
          return prev;
        });

        // merge assets: if new list differs by length or ids, replace; otherwise keep existing refs to minimize re-render
        setAssets((prev) => {
          const prevIds = (prev || []).map((a) => a.id).join(",");
          const newIds = (newAssets || []).map((a) => a.id).join(",");
          if (prevIds === newIds) {
            // update urls/expires for each item
            const next = (prev || []).map((p) => {
              const found = newAssets.find((n) => n.id === p.id);
              return found
                ? { ...p, url: found.url ?? p.url, expires_at: found.expires_at ?? p.expires_at, meta: found.meta ?? p.meta }
                : p;
            });
            return next;
          }
          return newAssets;
        });

        // update jobs similarly
        setJobs((prev) => {
          const prevIds = (prev || []).map((j) => j.id).join(",");
          const newIds = (newJobs || []).map((j) => j.id).join(",");
          if (prevIds === newIds) {
            return (prev || []).map((pj) => {
              const found = newJobs.find((nj) => nj.id === pj.id);
              return found ? { ...pj, ...found } : pj;
            });
          }
          return newJobs;
        });

        // schedule signed url refresh based on returned assets (without toggling loading)
        scheduleSignedUrlRefresh(newAssets || []);
      } catch (err) {
        if (err.name === "AbortError") {
          // ignore abort
        } else {
          console.error("[PhotoshootDashboard] fetchData error", err);
          setError(err.message || String(err));
          // show a toast on non-initial errors
          if (!opts.initial) toast.error("Failed to refresh photoshoot: " + (err.message || ""));
        }
      } finally {
        if (opts.initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [id]
  );

  // schedule a single signed url refresh before earliest expiry (20s buffer)
  function scheduleSignedUrlRefresh(assetList) {
    if (signedRefreshRef.current) {
      clearTimeout(signedRefreshRef.current);
      signedRefreshRef.current = null;
    }
    if (!Array.isArray(assetList) || assetList.length === 0) return;
    const expiries = assetList
      .map((a) => (a.expires_at ? Date.parse(a.expires_at) : null))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!expiries.length) return;
    const earliest = expiries[0];
    const refreshAt = earliest - 20000; // 20s before expiry
    const ms = Math.max(1000, refreshAt - Date.now());
    signedRefreshRef.current = setTimeout(() => {
      // refresh ONLY assets/jobs (no loading)
      fetchData({ initial: false });
    }, ms);
  }

  // adaptive polling: faster when a running job exists
  function startPolling() {
    stopPolling();
    const hasRunning = jobs.some((j) => j.status === "running" || j.status === "queued");
    const intervalMs = hasRunning ? 3000 : 15000;
    pollRef.current = setInterval(() => {
      if (visibilityRef.current === "hidden") return; // skip when hidden
      fetchData({ initial: false });
    }, intervalMs);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // initial load and set up polling, with visibility handling
  useEffect(() => {
    // set actual visibility on client
    if (typeof document !== "undefined" && document.visibilityState) {
      visibilityRef.current = document.visibilityState;
    }

    async function onMount() {
      await fetchData({ initial: true });

      // watch for visibility changes (client only)
      function onVisibilityChange() {
        if (typeof document !== "undefined") {
          visibilityRef.current = document.visibilityState;
          if (document.visibilityState === "visible") {
            // immediate refresh and restart polling
            fetchData({ initial: false }).then(() => {
              startPolling();
            }).catch(() => startPolling());
          } else {
            // stop polling when hidden
            stopPolling();
          }
        }
      }
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
      }

      // start polling after initial load
      startPolling();

      // cleanup
      return () => {
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibilityChange);
        }
        stopPolling();
        if (signedRefreshRef.current) clearTimeout(signedRefreshRef.current);
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch (e) {}
        }
      };
    }

    // run mount logic
    const cleanupPromise = onMount();

    // no synchronous cleanup required here; use the returned cleanup from onMount via effect return
    return () => {
      // ensure any pending cleanup is executed
      stopPolling();
      if (signedRefreshRef.current) clearTimeout(signedRefreshRef.current);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch (e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // restart polling whenever jobs change (so adaptive interval can apply)
  useEffect(() => {
    if (visibilityRef.current === "visible") {
      startPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.id}:${j.status}`).join("|")]);

  // enqueue job helper (kept for manual job run)
  async function enqueueJob() {
    if (!id) return;
    try {
      const res = await fetch(`/api/photoshoots/${encodeURIComponent(id)}/jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots: 3 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Create job failed (${res.status})`);
      toast.success("Job queued");
      // refresh immediately to pick up new job
      fetchData({ initial: false });
    } catch (err) {
      console.error("[PhotoshootDashboard] enqueue error", err);
      setError(err.message || String(err));
      toast.error("Failed to enqueue job: " + (err.message || ""));
    }
  }

  // NEW: run-or-create behavior:
  // - if base image exists -> go to create-more flow (/photoshoot/{id}/create)
  // - if base missing -> go to studio (/photoshoot/{id}/studio)
  function handleRunOrCreate() {
    if (!photoshoot) {
      toast.error("Photoshoot missing");
      return;
    }
    if (photoshoot.base_asset_id) {
      // has base: go to create-more UI where user creates additional shots
      router.push(`/photoshoot/${id}/studio/create-more`);
    } else {
      // no base: go to studio to create the single base image
      router.push(`/photoshoot/${id}/studio`);
    }
  }

  // UI
  if (loading) return <div className="w-full h-full min-h-[200px] flex items-center justify-center"><FetchLoader/></div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!photoshoot) return <div className="p-6">Photoshoot not found.</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold">{photoshoot.name}</h2>
          <div className="text-sm text-gray-500">{photoshoot.description}</div>
        </div>

        <div className="flex gap-2">
          {photoshoot.base_asset_id && (
            <button onClick={() => router.push(`/photoshoot/${id}/create-more`)} className="button-normal-orange text-white">
              Create more
            </button>
          )}

          {/* Run Photoshoot now routes to studio or create-more depending on base presence */}
          <button onClick={handleRunOrCreate} className="button-normal">
            Run Photoshoot
          </button>

          <button onClick={() => fetchData({ initial: false })} className="button-normal">
            Refresh
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-small font-semibold mb-2">Gallery</h3>
        <hr className="text-light my-7"/>
        {assets.length === 0 ? (
          <div className="text-sm text-gray-500">No images yet — run a photoshoot</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            {assets.map((a) => (
              <div key={a.id} className="box-bg-normal rounded-xs overflow-hidden border">
                {a.url ? (
                  <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img src={a.url} alt={a.meta?.filename || a.filename || a.id} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="p-4 h-48 flex items-center justify-center">No URL</div>
                )}

                <div className="p-3 flex justify-between items-center">
                  <div className="text-sm">{a.meta?.filename || a.filename || a.id}</div>
                  <div className="flex gap-2">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="button-normal-h-light">
                        Open
                      </a>
                    ) : null}
                    <button onClick={() => {
                      if (a.url) navigator.clipboard?.writeText(a.url);
                    }} className="button-normal">Copy</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
