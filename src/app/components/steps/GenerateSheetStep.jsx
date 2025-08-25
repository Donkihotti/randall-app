// src/components/steps/GenerateSheetStep.jsx
"use client";

import { useState } from "react";
import { enqueueModelSheet } from "../../../../lib/apiClient";
import ModelSheetViewer from "../ModelSheetViewer";

export default function GenerateSheetStep({ subjectId, subject, setStatus }) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function generatePreview() {
    if (!subjectId) return alert("No subject");
    setIsGenerating(true);
    try {
      const res = await enqueueModelSheet(subjectId, { previewOnly: true });
      if (!res?.ok) {
        alert("Enqueue failed: " + (res?.error || JSON.stringify(res)));
      } else {
        setStatus("generating-sheet");
      }
    } catch (err) {
      console.error(err);
      alert("Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded shadow">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Generate model sheet (preview)</h2>
          <div className="text-sm text-gray-600">Create low-res previews (cheap) to inspect the model.</div>
        </div>
        <div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded mr-2" onClick={generatePreview} disabled={isGenerating}>
            {isGenerating ? "Queuing…" : "Generate previews"}
          </button>
          <button className="px-3 py-2 border rounded" onClick={()=>setStatus("uploading")}>Back</button>
        </div>
      </div>

      <div className="mt-6">
        <ModelSheetViewer subjectId={subjectId} />
      </div>

      <div className="mt-6">
        <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={()=>setStatus("upscaling")}>
          Upscale selected / Finalize
        </button>
      </div>
    </div>
  );
}
