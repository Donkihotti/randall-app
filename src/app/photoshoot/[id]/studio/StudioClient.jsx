// src/app/photoshoot/[id]/studio/StudioClient.jsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import BaseImagePreviewModal from "@/components/Photoshoot/BaseImagePreviewModal";

/**
 * StudioClient
 * - photoshootId: string
 *
 * Flow:
 * - User types prompt and clicks "Generate base image".
 * - POST to /api/photoshoots/{id}/jobs with shots:1 and marker type:'base'
 * - Polls /api/photoshoots/{id} until at least one asset exists (or job completes)
 * - Opens BaseImagePreviewModal with the first returned asset (base image)
 * - Modal allows editing prompt + choose shots for variations and either:
 *     - "Create variations" -> posts job with reference_asset_id = baseAsset.id
 *     - "Accept & continue" -> routes to editor page to create more (no immediate job)
 */

export default function StudioClient({ photoshootId }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("product");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [waitingForAsset, setWaitingForAsset] = useState(false);
  const pollRef = useRef(null);
  const [baseAsset, setBaseAsset] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [jobId, setJobId] = useState(null);

  // Poll helper to fetch photoshoot until it has an asset
  async function pollForFirstAsset(timeoutMs = 60000, intervalMs = 1500) {
    const start = Date.now();
    return new Promise(async (resolve, reject) => {
      try {
        const check = async () => {
          try {
            const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}`, {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
              // on 401/403, reject immediately
              if (res.status === 401 || res.status === 403) {
                return reject(new Error("Unauthorized"));
              }
              // otherwise keep trying until timeout
            } else {
              const assets = Array.isArray(json.assets) ? json.assets : [];
              if (assets.length > 0) {
                return resolve(assets[0]);
              }
            }
          } catch (e) {
            // swallow and try again (network)
            console.warn("[Studio] poll check error", e);
          }
          if (Date.now() - start > timeoutMs) {
            return reject(new Error("timeout"));
          }
          pollRef.current = setTimeout(check, intervalMs);
        };
        await check();
      } catch (err) {
        reject(err);
      }
    });
  }

  async function handleGenerateBase(e) {
    e?.preventDefault?.();
    setError(null);
    if (!prompt || !prompt.trim()) {
      setError("Prompt is required for base image.");
      return;
    }
    setLoading(true);
    setWaitingForAsset(true);
    setBaseAsset(null);
    setJobId(null);

    try {
      // 1) Create a job for base image (shots=1, type=base)
      const body = {
        prompt: prompt.trim(),
        style,
        shots: 1,
        type: "base",
      };
      console.log("[Studio] create base job body:", body);
      const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);
      console.log("[Studio] create base job response:", res.status, json);
      if (!res.ok) throw new Error(json?.error || `Create job failed (${res.status})`);

      const createdJob = json?.job || json?.photoshoot_job || null;
      if (createdJob?.id) setJobId(createdJob.id);

      // 2) Poll until first asset appears
      const asset = await pollForFirstAsset(60000, 1500);
      console.log("[Studio] base asset found:", asset);
      setBaseAsset(asset);
      setModalOpen(true);
    } catch (err) {
      console.error("[Studio] generate base error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      setWaitingForAsset(false);
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // Modal callbacks
  async function handleCreateVariations({ newPrompt, shots }) {
    setModalOpen(false);
    setLoading(true);
    setError(null);
    try {
      const body = {
        prompt: newPrompt || prompt,
        style,
        shots: Number(shots || 3),
        reference_asset_id: baseAsset?.id || null,
      };
      console.log("[Studio] create variations job body:", body);
      const res = await fetch(`/api/photoshoots/${encodeURIComponent(photoshootId)}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      console.log("[Studio] create variations response:", res.status, json);
      if (!res.ok) throw new Error(json?.error || `Create variations failed (${res.status})`);
      // Navigate to the editor page where the user can create more and inspect jobs
      router.push(`/photoshoot/${photoshootId}/editor`);
    } catch (err) {
      console.error("[Studio] create variations error", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleAcceptBase() {
    setModalOpen(false);
    // Accept the base as the canonical base image and go to editor where user can create more
    router.push(`/photoshoot/${photoshootId}/editor`);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold mb-3">Studio — Create base image</h1>
      <p className="text-sm text-gray-500 mb-4">
        Compose a prompt and generate the base image for this photoshoot. After generation you'll preview and can edit the prompt or create more images.
      </p>

      <form onSubmit={handleGenerateBase} className="space-y-4 bg-white p-4 rounded shadow">
        <div>
          <label className="block text-sm font-medium mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="w-full border rounded px-3 py-2"
            placeholder="Describe the scene, model, clothing, camera, lighting..."
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Style</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border rounded px-2 py-1">
              <option value="product">Product</option>
              <option value="creative">Creative</option>
              <option value="editorial">Editorial</option>
              <option value="social">Social</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={loading || waitingForAsset} className="px-4 py-2 bg-blue-600 text-white rounded">
            {loading || waitingForAsset ? "Generating…" : "Generate base image"}
          </button>
          <button type="button" onClick={() => router.push(`/photoshoot/${photoshootId}/dashboard`)} className="px-3 py-2 border rounded">
            Cancel
          </button>
        </div>

        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        {waitingForAsset && <div className="text-sm text-gray-500 mt-2">Waiting for image…</div>}
      </form>

      <BaseImagePreviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        imageUrl={baseAsset?.url}
        filename={baseAsset?.meta?.filename || baseAsset?.id}
        defaultPrompt={prompt}
        onCreateVariations={handleCreateVariations}
        onAccept={handleAcceptBase}
      />
    </div>
  );
}
