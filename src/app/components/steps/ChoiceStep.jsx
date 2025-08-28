// src/components/steps/ChoiceStep.jsx
"use client";

import React from "react";
import ButtonOrange from "../buttons/ButtonOrange";

export default function ChoiceStep({ subject, onPickUpload, onPickGenerate, showNotification }) {
  const name = subject?.name || "(unnamed)";

  return (
    <div className="w-full flex flex-col items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-normal rounded-md p-6 shadow">
        <h2 className="text-xl font-semibold">Create model: <span className="text-sm text-gray-400">{name}</span></h2>
        <p className="text-sm text-gray-500 mt-2">
          How would you like to create this model? You can upload references (recommended), or try generating a model from scratch.
        </p>

        <div className="mt-6 flex gap-4">
          <div className="flex-1 p-4 border rounded">
            <h3 className="font-medium">Upload references</h3>
            <p className="text-sm text-gray-500 mt-2">Use your own face/body photos for best identity match and consistency.</p>
            <div className="mt-4">
              <ButtonOrange onClick={() => {
                if (typeof onPickUpload === "function") onPickUpload();
                else showNotification?.("Upload flow selected", "info");
              }}>
                Upload references
              </ButtonOrange>
            </div>
          </div>

          <div className="flex-1 p-4 border rounded">
            <h3 className="font-medium">Generate from scratch</h3>
            <p className="text-sm text-gray-500 mt-2">Create a model automatically using the name and base prompt (less accurate identity matching).</p>
            <div className="mt-4">
              <ButtonOrange onClick={() => {
                if (typeof onPickGenerate === "function") onPickGenerate();
                else showNotification?.("Generate from scratch selected", "info");
              }}>
                Generate from scratch
              </ButtonOrange>
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-400">
          Tip: Uploading references gives you much better, consistent results. Use generate-from-scratch only when you don't have refs.
        </div>
      </div>
    </div>
  );
}
