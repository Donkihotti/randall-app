"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function UploadAssetSupabase({ onUploaded, bucket = "uploads", label = "Upload" }) {
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setLoading(true);
    try {
      const ext = f.name.split(".").pop();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2,9)}.${ext}`;
      const { data, error } = await supabase.storage.from(bucket).upload(filename, f, {
        cacheControl: "3600",
        upsert: false
      });
      if (error) throw error;
      // if bucket is public, you can get public URL:
      const { publicURL } = supabase.storage.from(bucket).getPublicUrl(data.path);
      onUploaded?.({ url: publicURL, filename: filename, path: data.path });
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <label className="cursor-pointer inline-flex items-center gap-2">
        <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
        <button className="px-3 py-1 bg-gray-800 text-white rounded">{loading ? "Uploading…" : label}</button>
      </label>
    </div>
  );
}
