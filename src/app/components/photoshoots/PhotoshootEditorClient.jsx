// src/app/photoshoot/[id]/PhotoshootEditorClient.jsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * PhotoshootEditorClient
 * - creates a job to make images
 * - after job created, polls the photoshoot GET endpoint and waits for at least one asset
 * - when the first asset arrives, shows a PreviewModal with that image and an editable prompt box
 * - Accept -> navigates to studio/editor (you can change the target)
 */

function PreviewModal({ open, onClose, imageUrl, initialPrompt, onAccept }) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  useEffect(() => { setPrompt(initialPrompt ?? ""); }, [initialPrompt, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full box-bg-normal-plus max-w-2/3 shadow-lg overflow-hidden">
        <div className="p-3 border-b flex justify-between items-center">
          <div className="font-semibold">Preview base image</div>
          <button onClick={onClose} className="px-2 py-1">Close</button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="w-full h-72 bg-gray-100 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              // plain img because signed URLs may be external
              <img src={imageUrl} alt="preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-500">Image not available</div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Edit prompt (optional)</label>
            <textarea
              className="w-full h-40 border rounded p-2"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => onAccept({ prompt })}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Accept & Continue
              </button>
              <button onClick={onClose} className="px-3 py-2 border rounded">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PhotoshootEditorClient({ photoshootId }) {
  const router = useRouter();
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [fetchModelsErr, setFetchModelsErr] = useState(null);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("product");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [previewAssetId, setPreviewAssetId] = useState(null);
  const [shots, setShots] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPrompt, setPreviewPrompt] = useState("");
  
  

  const pollRef = useRef(null);

  // clamp shots range
  const MIN_SHOTS = 1;
  const MAX_SHOTS = 10;

  useEffect(() => {
    let mounted = true;
    async function loadModels() {
      setLoadingModels(true);
      setFetchModelsErr(null);
      try {
        const res = await fetch("/api/models", { method: "GET", credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `Failed to load models (${res.status})`);
        if (mounted) setModels(Array.isArray(json.models) ? json.models : []);
      } catch (err) {
        console.error("[PhotoshootEditor] loadModels error", err);
        if (mounted) setFetchModelsErr(err.message || String(err));
      } finally {
        if (mounted) setLoadingModels(false);
      }
    }
    loadModels();
    return () => { mounted = false; };
  }, []);

  // helper: poll photoshoot until assets arrive
  async function waitForFirstAsset(timeoutMs = 60_000, intervalMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          // if server returns 401/403, abort
          if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
        }
        const json = await res.json().catch(() => null);
        const assets = Array.isArray(json?.assets) ? json.assets : [];
        if (assets.length > 0) {
          // return first asset
          return assets[0];
        }
      } catch (err) {
        console.warn("[PhotoshootEditor] waitForFirstAsset fetch error", err);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }

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

    setLoading(true);
    try {
      const body = {
        prompt: prompt.trim(),
        style,
        shots: Number(shots),
        reference_collection_id: selectedModelId || null,
        // send job type "base" so worker could treat differently if desired
        type: "base",
      };

      console.log("[PhotoshootEditor] posting job body:", body);

      const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);
      console.log("[PhotoshootEditor] create response status:", res.status, "json:", json);

      if (!res.ok) {
        throw new Error(json?.error || `Create failed (${res.status})`);
      }

      // job created. Now wait for the worker to produce the base image.
      // show a small "waiting" UI while polling. We'll poll up to 60s.
      const asset = await waitForFirstAsset(60_000, 2000);
      if (!asset) {
        // no asset within timeout -> fall back: navigate to dashboard so user can see jobs
        console.warn("[PhotoshootEditor] no asset found within timeout, redirecting to dashboard");
        router.push(`/photoshoot/${photoshootId}/dashboard`);
        return;
      }

      // open preview modal with first asset's url and the prompt
      setPreviewImage(asset.url ?? asset.url_fallback ?? null);
      setPreviewPrompt(prompt.trim());
      setPreviewOpen(true);
      setPreviewAssetId(asset.id); 
    } catch (err) {
      console.error("[PhotoshootEditor] create error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function onAcceptPreview(editedPrompt) {
    // NOTE: editedPrompt is the prompt the user typed in preview modal (if you capture it)
    const params = new URLSearchParams();
    if (previewAssetId) params.set("baseAssetId", previewAssetId);
    if (editedPrompt) params.set("prompt", editedPrompt);
    if (style) params.set("style", style);
    // close modal then navigate
    setPreviewOpen(false);
    router.push(`/photoshoot/${encodeURIComponent(photoshootId)}/studio/create-more?${params.toString()}`);
  }

  return (
    <div className="w-full box-bg-normal p-3.5">
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-small font-semibold mb-1 ">Prompt</label>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the scene, model, clothing, camera style, lighting, composition..."
            rows={6}
            className="w-full border rounded px-3 py-2 textarea-default bg-normal-plus"
          />
          <div className="text-xs text-lighter mt-1">Tip: be specific about clothing, color, mood, camera (e.g. 50mm f/1.8), and background.</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-small font-semibold mb-1">Style preset</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border rounded px-2 py-1">
              <option value="product">Product</option>
              <option value="creative">Creative</option>
              <option value="editorial">Editorial</option>
              <option value="social">Social</option>
            </select>
            <div className="text-xs text-lighter mt-1">Style persists across shots in the job.</div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Shots</label>
            <input
              type="number"
              min={MIN_SHOTS}
              max={MAX_SHOTS}
              value={shots}
              onChange={(e) => setShots(Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, Number(e.target.value || 1))))}
              className="w-32 border rounded px-2 py-1"
            />
            <div className="text-xs text-lighter mt-1">How many images to create (max {MAX_SHOTS}).</div>
          </div>
        </div>

        <div>
          <label className="block text-small font-semibold mb-1">Use a saved model (optional)</label>
          {loadingModels ? (
            <div className="text-sm text-gray-500">Loading models…</div>
          ) : fetchModelsErr ? (
            <div className="text-sm text-red-600">Failed to load models: {fetchModelsErr}</div>
          ) : (
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full border rounded px-2 py-1"
            >
              <option value="">No model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          )}
          <div className="text-xs text-lighter mt-1">Selecting a model will bias the generation to that reference (if worker supports it).</div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/photoshoot/${photoshootId}/dashboard`)}
            className="button-normal-h-light"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="button-normal-orange disabled:opacity-60"
          >
            {loading ? "Creating…" : "Create base image"}
          </button>
        </div>
      </form>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        imageUrl={previewImage}
        initialPrompt={previewPrompt}
        onAccept={({ prompt }) => onAcceptPreview({ prompt })}
      />
    </div>
  );
}
