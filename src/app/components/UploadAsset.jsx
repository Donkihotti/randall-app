// src/components/UploadAsset.jsx
"use client";

import React, { useRef, useState } from "react";

/*
  UploadAsset props:
    - onUploaded(uploadObj) : callback called with the object returned by /api/upload => { url, filename }
    - onError(err) optional
    - accept (optional) : mime types (default "image/*")
*/
export default function UploadAsset({ onUploaded, onError, accept = "image/*" }) {
  const inputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setIsUploading(true);
    try {
      // small client-side guard
      if (!file.type.startsWith("image/")) throw new Error("Only image files supported");

      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const parts = fr.result.split(",");
          resolve(parts[1]);
        };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });

      // POST upload
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, b64 }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Upload failed response:", data);
        throw new Error(data?.error || `Upload failed (${res.status})`);
      }

      if (!data?.url) throw new Error("Upload did not return url");

      // save preview url and call parent with the full object
      setLastUrl(data.url);
      const uploadObj = { url: data.url, filename: data.filename || data.url.split("/").pop() };
      if (typeof onUploaded === "function") onUploaded(uploadObj);
    } catch (err) {
      console.error("UploadAsset error:", err);
      if (typeof onError === "function") onError(err);
      alert("Upload failed — see console.");
    } finally {
      setIsUploading(false);
      setIsDragOver(false);
    }
  }

  function openFileDialog() {
    inputRef.current?.click();
  }

  function onInputChange(e) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="relative w-full h-full">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onInputChange}
      />

      <div
        role="button"
        aria-label="Upload file"
        tabIndex={0}
        onClick={openFileDialog}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFileDialog();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={
          "absolute inset-0 cursor-pointer focus:outline-none " +
          (isUploading ? "pointer-events-none" : "")
        }
      >
        {lastUrl ? (
          <img
            src={lastUrl}
            alt="uploaded"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-gray-400">Drop image or click to upload</span>
          </div>
        )}

        {isDragOver && (
          <div className="absolute inset-0 pointer-events-none outline-2 outline-indigo-400/80 bg-indigo-50/20" />
        )}

        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-black/50 text-white px-3 py-2 rounded">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" className="opacity-75" />
              </svg>
              <span className="text-sm">Uploading…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
