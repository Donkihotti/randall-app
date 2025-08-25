"use client";

import { useState } from "react";
import { enqueueUpscale } from "../../../../lib/apiClient";

export default function UpscaleStep({ subjectId, setStatus }) {
  const [isRunning, setIsRunning] = useState(false);

  async function doUpscale() {
    if (!subjectId) return;
    setIsRunning(true);
    try {
      // payload may include which assets to upscale; we'll pass empty to upscale all approved
      const res = await enqueueUpscale(subjectId, { upscaleAll: true });
      if (!res?.ok) {
        alert("Upscale enqueue failed: " + (res?.error || JSON.stringify(res)));
      } else {
        // you should poll status; but for skeleton we jump to finalize when done
        setStatus("finalize");
      }
    } catch (err) {
      console.error(err);
      alert("Upscale failed");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-lg font-semibold">Upscale (final)</h2>
      <p className="text-sm text-gray-600">This will run higher resolution generation and face restoration. Costs may apply.</p>

      <div className="mt-4 flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={doUpscale} disabled={isRunning}>
          {isRunning ? "Enqueuing…" : "Start Upscale"}
        </button>
        <button className="px-4 py-2 border rounded" onClick={()=>setStatus("sheet-preview")}>Back</button>
      </div>
    </div>
  );
}
