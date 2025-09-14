"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PhotoshootEditorClient
 * Props:
 *  - photoshootId: string (required)
 *
 * Behavior:
 *  - fetches /api/models (user's saved_collections) to provide optional model reference
 *  - posts job to /api/photoshoots/{id}/jobs with prompt, style, shots, reference_collection_id
 *  - navigates to /photoshoot/{id}/dashboard on success
 */
export default function PhotoshootEditorClient({ photoshootId }) {
  const router = useRouter();
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [fetchModelsErr, setFetchModelsErr] = useState(null);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("product");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [shots, setShots] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
        if (!res.ok) {
          throw new Error(json?.error || `Failed to load models (${res.status})`);
        }
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
      };

      console.log("[PhotoshootEditor] posting job body:", body);

      const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // important so server sees HttpOnly cookie
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);
      console.log("[PhotoshootEditor] create response status:", res.status, "json:", json);

      if (!res.ok) {
        throw new Error(json?.error || `Create failed (${res.status})`);
      }

      // success: job created. Navigate back to dashboard so user sees job + results.
      // router.push() is fine; replace to avoid back-button weirdness if desired:
      router.push(`/photoshoot/${photoshootId}/dashboard`);
    } catch (err) {
      console.error("[PhotoshootEditor] create error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full box-bg-normal p-3.5">
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Prompt</label>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the scene, model, clothing, camera style, lighting, composition..."
            rows={6}
            className="w-full border rounded px-3 py-2"
          />
          <div className="text-xs text-gray-500 mt-1">Tip: be specific about clothing, color, mood, camera (e.g. 50mm f/1.8), and background.</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Style preset</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border rounded px-2 py-1">
              <option value="product">Product</option>
              <option value="creative">Creative</option>
              <option value="editorial">Editorial</option>
              <option value="social">Social</option>
            </select>
            <div className="text-xs text-gray-500 mt-1">Style persists across shots in the job.</div>
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
            <div className="text-xs text-gray-500 mt-1">How many images to create (max {MAX_SHOTS}).</div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Use a saved model (optional)</label>
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
              <option value="">— No model —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          )}
          <div className="text-xs text-gray-500 mt-1">Selecting a model will bias the generation to that reference (if worker supports it).</div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60"
          >
            {loading ? "Creating…" : "Create images"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/photoshoot/${photoshootId}/dashboard`)}
            className="px-3 py-2 border rounded"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
