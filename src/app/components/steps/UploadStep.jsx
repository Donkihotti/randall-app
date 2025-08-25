// src/components/steps/UploadStep.jsx
"use client";

import { useState } from "react";
import UploadAsset from "../UploadAsset";
import { createSubject } from "../../../../lib/apiClient";

export default function UploadStep({ initialSubject = {}, onCreated, subjectId, setStatus }) {
  const [faceUploads, setFaceUploads] = useState([]); // {url,filename}
  const [bodyUploads, setBodyUploads] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreateSubject() {
    if (!initialSubject?.name) return alert("Missing name");
    setIsCreating(true);
    try {
      const payload = {
        name: initialSubject.name,
        basePrompt: initialSubject.basePrompt || "",
        consentConfirmed: initialSubject.consent || false,
        faceRefs: faceUploads.map(u => ({ url: u.url, filename: u.filename })),
        bodyRefs: bodyUploads.map(u => ({ url: u.url, filename: u.filename })),
      };
      const res = await createSubject(payload);
      if (res?.subjectId) {
        onCreated(res);
        // optimistic status
        setStatus("validating");
      } else {
        console.error("create subject failed", res);
        alert("Create subject failed — check console");
      }
    } catch (err) {
      console.error(err);
      alert("Create failed (console)");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-lg font-semibold">Upload references</h2>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border p-3 rounded">
          <h4 className="font-medium">Face (recommended: frontal high-res)</h4>
          <div className="mt-2 h-36 relative bg-gray-50 border rounded overflow-hidden">
            <UploadAsset onUploaded={(u)=>setFaceUploads(prev=>[...prev,u])} />
          </div>
          <div className="mt-2 text-xs text-gray-600">You can upload multiple faces; a clear front face works best.</div>
          <div className="mt-2">
            {faceUploads.map((f,i)=>(<div key={i} className="text-xs">{f.filename}</div>))}
          </div>
        </div>

        <div className="border p-3 rounded">
          <h4 className="font-medium">Body (full body references)</h4>
          <div className="mt-2 h-44 relative bg-gray-50 border rounded overflow-hidden">
            <UploadAsset onUploaded={(u)=>setBodyUploads(prev=>[...prev,u])} />
          </div>
          <div className="mt-2 text-xs text-gray-600">T-pose or neutral full-body is preferred.</div>
          <div className="mt-2">
            {bodyUploads.map((b,i)=>(<div key={i} className="text-xs">{b.filename}</div>))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded" disabled={isCreating} onClick={handleCreateSubject}>
          {isCreating ? "Creating..." : (subjectId ? "Recreate/Update Subject" : "Create Subject")}
        </button>
        <button className="px-4 py-2 border rounded" onClick={()=>setStatus("start")}>Back</button>
      </div>

      <div className="mt-3 text-sm text-gray-500">After creating, the server will validate your uploads and create thumbnails.</div>
    </div>
  );
}
