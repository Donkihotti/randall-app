"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * CreateMoreClient
 * props:
 *  - photoshootId: string (preferred)
 *  - searchParams: object (from server) or can be read from window.location
 *
 * Defensive: if photoshootId not provided, attempt to extract from pathname.
 */
export default function CreateMoreClient({ photoshootId: photoshootIdProp = null, searchParams = {} }) {
  const router = useRouter();

  // try server-passed id first; fallback to parsing path if missing (defensive)
  function deriveIdFromPath() {
    try {
      if (typeof window === "undefined") return null;
      const m = window.location.pathname.match(/\/photoshoot\/([0-9a-fA-F-]{36})/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  const photoshootId = photoshootIdProp ?? deriveIdFromPath();

  const baseAssetIdFromQuery = (searchParams && searchParams.baseAssetId) || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("baseAssetId") : null);
  const promptFromQuery = (searchParams && searchParams.prompt) || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("prompt") : "") || "";
  const styleFromQuery = (searchParams && searchParams.style) || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("style") : "") || "product";

  const [photoshoot, setPhotoshoot] = useState(null);
  const [baseAsset, setBaseAsset] = useState(null);
  const [prompt, setPrompt] = useState(promptFromQuery);
  const [style, setStyle] = useState(styleFromQuery);
  const [shots, setShots] = useState(3);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const MIN_SHOTS = 1;
  const MAX_SHOTS = 10;

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!photoshootId) {
        setError("Missing photoshoot id");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `API ${res.status}`);
        if (!mounted) return;

        setPhotoshoot(json.photoshoot || null);

        // find base asset (prefer query baseAssetId)
        let chosen = null;
        if (baseAssetIdFromQuery && Array.isArray(json.assets)) {
          chosen = json.assets.find(a => String(a.id) === String(baseAssetIdFromQuery));
        }
        if (!chosen && Array.isArray(json.assets) && json.assets.length > 0) {
          chosen = json.assets[0];
        }
        setBaseAsset(chosen || null);

        // if no prompt but photoshoot contains prompt, use it
        if (!prompt && json.photoshoot?.prompt) setPrompt(json.photoshoot.prompt);
      } catch (err) {
        console.error("[CreateMore] load error", err);
        if (mounted) setError(err.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [photoshootId, baseAssetIdFromQuery]);

  async function handleCreate(e) {
    e?.preventDefault?.();
    setError(null);

    if (!photoshootId) {
      setError("Missing photoshoot ID");
      return;
    }
    if (!prompt || !prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (shots < MIN_SHOTS || shots > MAX_SHOTS) {
      setError(`Shots must be between ${MIN_SHOTS} and ${MAX_SHOTS}`);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        type: "variation",
        shots: Number(shots),
        parameters: {
          base_asset_id: baseAsset?.id || baseAssetIdFromQuery || null,
          prompt: prompt.trim(),
          style,
        },
      };

      const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}/jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      console.log("[CreateMore] enqueue response", res.status, json);
      if (!res.ok) throw new Error(json?.error || `Create job failed (${res.status})`);

      // success: go to dashboard to watch progress and gallery
      router.push(`/photoshoot/${photoshootId}/dashboard`);
    } catch (err) {
      console.error("[CreateMore] create error", err);
      setError(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6">Loading studio…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!photoshoot) return <div className="p-6">Photoshoot not found.</div>;

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{photoshoot.name}</h2>
          <div className="text-sm text-gray-500">{photoshoot.description}</div>
          <div className="text-xs text-gray-400 mt-1">Status: {photoshoot.status}</div>
        </div>

        <div>
          <button onClick={() => router.push(`/photoshoot/${photoshootId}/dashboard`)} className="px-3 py-1 border rounded">
            Back to Dashboard
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <h3 className="text-sm font-medium mb-2">Base image</h3>
          <div className="w-full h-96 bg-gray-100 flex items-center justify-center border rounded overflow-hidden">
            {baseAsset && baseAsset.url ? (
              <img src={baseAsset.url} alt={baseAsset.meta?.filename || baseAsset.id} className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-500">No base image available</div>
            )}
          </div>
        </div>

        <div className="p-4 box-bg-normal border rounded">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <textarea className="w-full border rounded px-2 py-1" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Style</label>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border rounded px-2 py-1">
                <option value="product">Product</option>
                <option value="creative">Creative</option>
                <option value="editorial">Editorial</option>
                <option value="social">Social</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Shots</label>
              <input type="number" min={MIN_SHOTS} max={MAX_SHOTS} value={shots}
                onChange={(e) => setShots(Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, Number(e.target.value || 1))))}
                className="w-28 border rounded px-2 py-1" />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => router.push(`/photoshoot/${photoshootId}/dashboard`)} className="button-normal-h-light">
                Cancel
              </button>
              <button type="submit" className="button-normal-orange" disabled={submitting}>
                {submitting ? "Creating…" : "Create more images"}
              </button>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}
