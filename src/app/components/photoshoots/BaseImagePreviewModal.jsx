// src/components/Photoshoot/BaseImagePreviewModal.jsx
"use client";

import { useEffect, useState } from "react";

/**
 * BaseImagePreviewModal props:
 * - open (bool)
 * - onClose (fn)
 * - imageUrl (string)
 * - filename (string)
 * - defaultPrompt (string)
 * - onCreateVariations({ newPrompt, shots }) => Promise or void
 * - onAccept() => void
 */
export default function BaseImagePreviewModal({
  open,
  onClose,
  imageUrl,
  filename,
  defaultPrompt = "",
  onCreateVariations,
  onAccept,
}) {
  const [prompt, setPrompt] = useState(defaultPrompt || "");
  const [shots, setShots] = useState(3);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setPrompt(defaultPrompt || "");
  }, [defaultPrompt, open]);

  if (!open) return null;

  async function handleCreate() {
    if (!prompt || !prompt.trim()) return alert("Please provide a prompt.");
    setLoading(true);
    try {
      if (typeof onCreateVariations === "function") {
        await onCreateVariations({ newPrompt: prompt.trim(), shots: Number(shots) });
      }
    } catch (e) {
      console.error("[BaseImagePreviewModal] create variations error", e);
      alert("Failed to create variations: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white w-full max-w-3xl rounded shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="text-md font-semibold">Preview base image</div>
          <div>
            <button onClick={onClose} className="px-2 py-1 text-sm">Close</button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="w-full h-80 bg-gray-100 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt={filename} className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="text-sm text-gray-500">No image available</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Edit prompt (optional)</label>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
            <div className="text-xs text-gray-500 mt-1">You can edit the prompt before creating variations to refine results.</div>
          </div>

          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs mb-1">Shots</label>
              <input
                type="number"
                min={1}
                max={10}
                value={shots}
                onChange={(e) => setShots(Math.max(1, Math.min(10, Number(e.target.value || 1))))}
                className="w-20 border rounded px-2 py-1"
              />
              <div className="text-xs text-gray-500 mt-1">1–10</div>
            </div>

            <div className="ml-auto flex gap-2">
              <button
                onClick={handleCreate}
                disabled={loading}
                className="px-3 py-1 bg-blue-600 text-white rounded"
              >
                {loading ? "Creating…" : "Create variations"}
              </button>
              <button
                onClick={() => {
                  if (typeof onAccept === "function") onAccept();
                }}
                className="px-3 py-1 border rounded"
              >
                Accept & continue
              </button>
              <button onClick={onClose} className="px-3 py-1 border rounded">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
