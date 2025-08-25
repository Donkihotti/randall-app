// src/components/steps/FinalizeStep.jsx
"use client";

import { useState } from "react";
import { approveSubject } from "../../../../lib/apiClient";

export default function FinalizeStep({ subjectId, subject }) {
  const [isSaving, setIsSaving] = useState(false);

  async function finalize() {
    if (!subjectId) return;
    if (!confirm("Finalize and mark model Ready?")) return;
    setIsSaving(true);
    try {
      await approveSubject(subjectId);
      alert("Model finalized — it's Ready.");
      // redirect or update UI — for skeleton just reload page
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Finalize failed");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-lg font-semibold">Finalize model</h2>
      <p className="text-sm text-gray-600">Review final images and metadata, then finalize your model.</p>

      <div className="mt-4">
        <strong>Model:</strong> {subject?.name}
      </div>

      <div className="mt-4">
        <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={finalize} disabled={isSaving}>
          {isSaving ? "Finalizing…" : "Finalize model"}
        </button>
      </div>
    </div>
  );
}
