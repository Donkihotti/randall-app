// src/app/photoshoot/[id]/PhotoshootEditorClient.jsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * PhotoshootEditorClient
 * - creates a job to make a single base image (shots = 1)
 * - after job created, polls the photoshoot GET endpoint and waits for at least one asset
 * - when the first asset arrives, shows a PreviewModal with that image and an editable prompt box
 * - Accept -> PATCH photoshoot to set base_asset_id (and optional prompt), then navigate to create-more
 */

function PreviewModal({ open, onClose, imageUrl, initialPrompt, onAccept, accepting }) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  useEffect(() => { setPrompt(initialPrompt ?? ""); }, [initialPrompt, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full box-bg-normal-plus max-w-2/3 shadow-lg overflow-hidden ">
        <div className="p-3 flex justify-between items-center">
          <div className="font-semibold">Preview base image</div>
          <button onClick={onClose} className="px-2 py-1">Close</button>
        </div>

        <div className="p-3.5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="w-full h-96 bg-gray-100 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt="preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-500">Image not available</div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Edit prompt (optional)</label>
            <textarea
              className="textarea-default bg-normal-dark h-40 border rounded p-2"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex gap-2 mt-auto w-full flex-row justify-end">
            <button onClick={onClose} className="button-normal-h-light">Cancel</button>
              <button
                onClick={() => onAccept({ prompt })}
                className="button-normal-orange"
                disabled={accepting}
              >
                {accepting ? "Accepting…" : "Accept & Continue"}
              </button>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPrompt, setPreviewPrompt] = useState("");
  const [accepting, setAccepting] = useState(false);

  // model preview url
  const [modelPreviewUrl, setModelPreviewUrl] = useState(null);

  const pollRef = useRef(null);

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

  // produce a model preview url whenever selectedModelId or models change
  useEffect(() => {
    if (!selectedModelId) {
      setModelPreviewUrl(null);
      return;
    }
    const m = (models || []).find((x) => String(x.id) === String(selectedModelId));
    if (!m) {
      setModelPreviewUrl(null);
      return;
    }

    // try several common fields for an image/thumbnail
    const candidate =
      m.preview_url ||
      m.thumbnail_url ||
      m.thumbnail ||
      (m.meta && (m.meta.thumbnail || m.meta.preview)) ||
      m.url ||
      m.image ||
      // nested assets (e.g. { assets: [{url}] })
      (Array.isArray(m.assets) && m.assets[0] && (m.assets[0].url || m.assets[0].thumbnail)) ||
      null;

    // normalize if nested asset object
    let url = null;
    if (candidate && typeof candidate === "string") url = candidate;
    else if (candidate && typeof candidate === "object") url = candidate.url || candidate.thumbnail || null;

    setModelPreviewUrl(url);
  }, [selectedModelId, models]);

  // helper: poll photoshoot until assets arrive (first asset)
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
          if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
        }
        const json = await res.json().catch(() => null);
        const assets = Array.isArray(json?.assets) ? json.assets : [];
        if (assets.length > 0) return assets[0];
      } catch (err) {
        console.warn("[PhotoshootEditor] waitForFirstAsset fetch error", err);
        if (err && (err.message === "unauthorized" || err.message === "Unauthorized")) throw err;
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

    setLoading(true);
    try {
      // Base image always uses 1 shot
      const body = {
        prompt: prompt.trim(),
        style,
        shots: 1,
        reference_collection_id: selectedModelId || null,
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

      // job created -> wait for the worker to produce the single base image
      const asset = await waitForFirstAsset(60_000, 2000);
      if (!asset) {
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

  // Accept handler: PATCH photoshoot to set base_asset_id (and optionally prompt), then navigate to create-more
  async function onAcceptPreview({ prompt: editedPrompt } = {}) {
    if (!photoshootId) {
      console.error("[PhotoshootEditor] onAcceptPreview missing photoshootId");
      return;
    }

    setAccepting(true);
    try {
      const payload = {};
      if (previewAssetId) payload.base_asset_id = previewAssetId;
      if (typeof editedPrompt === "string" && editedPrompt.trim().length > 0) payload.prompt = editedPrompt.trim();

      // PATCH /api/photoshoots/{id}
      const patchRes = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const patchJson = await patchRes.json().catch(() => null);
      console.log("[PhotoshootEditor] PATCH photoshoot response:", patchRes.status, patchJson);

      if (!patchRes.ok) {
        const msg = patchJson?.error || `Failed to set base image (${patchRes.status})`;
        throw new Error(msg);
      }

      // close modal and navigate to create-more studio
      setPreviewOpen(false);

      const params = new URLSearchParams();
      if (previewAssetId) params.set("baseAssetId", previewAssetId);
      if (editedPrompt) params.set("prompt", editedPrompt);
      if (style) params.set("style", style);

      router.push(`/photoshoot/${encodeURIComponent(photoshootId)}/studio/create-more?${params.toString()}`);
    } catch (err) {
      console.error("[PhotoshootEditor] onAcceptPreview error", err);
      setError(err.message || String(err));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="w-full box-bg-normal p-3.5">
      {/* Model preview area */}
      {selectedModelId && modelPreviewUrl && (
        <div className="mb-4 p-3 border rounded flex items-center gap-4 bg-white">
          <div className="w-20 h-20 bg-gray-100 overflow-hidden rounded">
            <img src={modelPreviewUrl} alt="model preview" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Selected model</div>
            <div className="text-xs text-gray-500 mt-1">{(models.find(m => String(m.id) === String(selectedModelId))?.name) || selectedModelId}</div>
          </div>
          <div>
            <button onClick={() => setSelectedModelId("")} className="px-2 py-1 border rounded text-sm">Deselect</button>
          </div>
        </div>
      )}

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
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border-lighter border rounded-md px-2 py-1">
              <option value="product">Product</option>
              <option value="creative">Creative</option>
              <option value="editorial">Editorial</option>
              <option value="social">Social</option>
            </select>
            <div className="text-xs text-lighter mt-1">Style persists across shots in the job.</div>
          </div>

          {/* Shots input removed — base image always generates a single image */}
          <div>
            <label className="block text-sm font-medium mb-1">&nbsp;</label>
            <div className="text-xs text-lighter mt-2">A single base image will be generated. You can create more after accepting the base image.</div>
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
              className="w-full border-lighter border rounded-xs px-2 py-1"
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
        accepting={accepting}
        onAccept={({ prompt }) => onAcceptPreview({ prompt })}
      />
    </div>
  );
}
