"use client";

import React from "react";

export default function SafetyModal({ open, message = "", onClose = () => {}, onEdit = () => {} }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white max-w-lg w-full rounded p-6 shadow-lg">
        <h3 className="text-lg font-semibold mb-2">Content flagged by safety filter</h3>
        <p className="text-sm text-gray-700 mb-4">{message || "The requested prompt or input was flagged by the model's safety filters. Please edit your prompt or remove potentially sensitive input."}</p>

        <div className="flex gap-3 justify-end">
          <button className="px-3 py-2 rounded border" onClick={onClose}>Close</button>
          <button className="px-3 py-2 bg-orange-500 text-white rounded" onClick={() => { onEdit(); onClose(); }}>
            Edit prompt
          </button>
        </div>
      </div>
    </div>
  );
}
