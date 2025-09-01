"use client";
import React from "react";

export default function LoadingOverlay({ visible = false, message = "Generating picture…" }) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/90">
      <div className="text-center">
        <div className="mb-4">
          {/* simple CSS spinner */}
          <div className="inline-block w-12 h-12 border-4 border-default-orange border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="text-default-white text-sm">{message}</div>
      </div>
    </div>
  );
}
