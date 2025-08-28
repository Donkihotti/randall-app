"use client";
import React from "react";

export default function FlowNavButtons({
  onBack,
  onContinue,
  continueLabel = "Continue",
  backLabel = "Back",
  continueDisabled = false,
  backDisabled = false,
}) {
  return (
    <div className="flex items-center gap-3 mt-4">
      <button
        onClick={onBack}
        disabled={backDisabled}
        className="px-4 py-2 border rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
        type="button"
      >
        {backLabel}
      </button>

      <button
        onClick={onContinue}
        disabled={continueDisabled}
        className="px-4 py-2 bg-default-orange text-white rounded hover:bg-orange-600 disabled:opacity-40"
        type="button"
      >
        {continueLabel}
      </button>
    </div>
  );
}
