// src/components/CreateModelPage.jsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import UploadAsset from "./UploadAsset";

/*
  CreateModelPage
  - Uses UploadAsset (which posts to /api/upload and calls onUploaded(url)) to collect face/body refs.
  - POSTs to /api/subject to create the subject.
  - Polls /api/subject/:id/status to display progress & assets.
  - Allows enqueuing generate-views and approving the subject.
*/

export default function CreateModelPage() {
  const [name, setName] = useState("");
  const [basePrompt, setBasePrompt] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // arrays of URLs returned by UploadAsset.onUploaded
  const [faceUrls, setFaceUrls] = useState([]);
  const [bodyUrls, setBodyUrls] = useState([]);

  // Subject/job state
  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [statusPollRunning, setStatusPollRunning] = useState(false);
  const pollRef = useRef(null);

  // generate-views options
  const [selectedViews, setSelectedViews] = useState({
    front: true,
    left: true,
    right: true,
    back: false,
    "face-9angles": false,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(null);

  // helper: update face url list
  function onFaceUploaded(url) {
    setFaceUrls(prev => [...prev, url]);
  }
  function onBodyUploaded(url) {
    setBodyUrls(prev => [...prev, url]);
  }

  async function createSubject() {
    if (!name) return alert("Please enter a model name");
    if (!consentConfirmed) {
      if (!confirm("You must confirm consent to continue. Do you confirm?")) return;
    }
    if (faceUrls.length === 0 && bodyUrls.length === 0) {
      return alert("Please upload at least one face or body reference");
    }

    setIsCreating(true);
    setMessage("Creating subject...");

    try {
      const payload = {
        name,
        consentConfirmed,
        basePrompt,
        faceRefs: faceUrls.map(u => ({ url: u })),
        bodyRefs: bodyUrls.map(u => ({ url: u })),
      };

      const res = await fetch("/api/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("create subject error:", data);
        alert("Failed to create subject: " + (data?.error || res.status));
        setIsCreating(false);
        setMessage(null);
        return;
      }

      setSubjectId(data.subjectId);
      setMessage("Subject queued. Starting status checks...");
      startPollingStatus(data.subjectId);
    } catch (err) {
      console.error("createSubject error", err);
      alert("Create failed, check console");
      setMessage(null);
      setIsCreating(false);
    }
  }

  function startPollingStatus(id) {
    if (!id) return;
    // stop any existing poll
    stopPollingStatus();

    setStatusPollRunning(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/subject/${id}/status`);
        const data = await res.json();
        if (res.ok && data?.subject) {
          setSubject(data.subject);
          setMessage(`Status: ${data.subject.status}`);
          // stop polling if finished states
          if (["ready", "awaiting-approval", "generated", "failed"].includes(data.subject.status)) {
            stopPollingStatus();
            setMessage(`Status: ${data.subject.status}`);
            setIsCreating(false);
          }
        } else {
          console.warn("status fetch error", data);
        }
      } catch (err) {
        console.error("poll error", err);
      }
    }, 2000);
  }

  function stopPollingStatus() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStatusPollRunning(false);
  }

  useEffect(() => {
    // cleanup on unmount
    return () => stopPollingStatus();
  }, []);

  // enqueue generate views
  async function enqueueGenerateViews() {
    if (!subjectId) return alert("No subject created yet.");
    const views = Object.entries(selectedViews).filter(([, v]) => v).map(([k]) => k);
    if (views.length === 0) return alert("Select at least one view to generate");

    setIsGenerating(true);
    setMessage("Enqueuing generate-views job...");

    try {
      const res = await fetch(`/api/subject/${subjectId}/generate-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views, previewOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("enqueue error", data);
        alert("Failed to enqueue generation: " + (data?.error || res.status));
      } else {
        setMessage("Generation job queued. Polling status...");
        // restart polling to pick up previews when ready
        startPollingStatus(subjectId);
      }
    } catch (err) {
      console.error("enqueueGenerateViews error", err);
      alert("Enqueue failed, check console");
    } finally {
      setIsGenerating(false);
    }
  }

  async function approveSubject() {
    if (!subjectId) return alert("No subject");
    if (!confirm("Mark this subject as Ready?")) return;
    try {
      const res = await fetch(`/api/subject/${subjectId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert("Approve failed: " + (data?.error || res.status));
      } else {
        setSubject(data.subject);
        setMessage("Subject approved & Ready");
      }
    } catch (err) {
      console.error("approve error", err);
      alert("Approve failed");
    }
  }

  // helper toggles for view checkboxes
  function toggleView(key) {
    setSelectedViews(prev => ({ ...prev, [key]: !prev[key] }));
  }

    //create model sheet
    async function createModelSheet(subjectId) {
    if (!subjectId) return alert("No subjectId");
    try {
      const res = await fetch(`/api/subject/${subjectId}/generate-model-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewOnly: true })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("enqueue error", data);
        alert("Failed to enqueue model sheet job: " + (data.error || res.status));
      } else {
        alert("Model sheet job queued. JobId: " + data.jobId);
      }
    } catch (err) {
      console.error("createModelSheet error", err);
      alert("Request failed (see console).");
    }
  }

  
  return (
    <div className="text-neutral-300 p-5 max-w-[1100px]">
      <h1 className="text-header-2 mb-2 leading-none">Create Model</h1>
      <p className="text-sm font-semibold">Start by uploading a reference or start from prompt</p>
      <div className="mt-10 text-small">
        <p>TIPS</p>
        <p>1. For best results upload a body reference with a T-Pose</p>
        <p>2. For the best face match upload a high quality image from the front</p>
        <button className="py-2 px-4 bg-normal-dark rounded-lg mt-5">See examples</button>
      </div>
    
      <section className="mb-3 mt-8">
        <label className="block mb-1.5 font-medium">Model name</label>
        <input
          className="w-full px-3 py-2 bg-normal-dark rounded-md"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`"Model 1"`}
        />
  
        <div className="mt-2.5">
          <label className="inline-flex items-start">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span className="ml-2">I confirm I have permission / consent to create and use this subject.</span>
          </label>
        </div>
      </section>
  
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
      <div className="rounded-lg bg-normal-dark hover:cursor-pointer hover:border hover:border-[#545454] w-44 h-44 relative overflow-hidden">
        <div className="bg-normal px-4 py-1 rounded-md w-1/2 m-2">
            <h3 className="text-small font-medium">Face</h3>
        </div>
            <UploadAsset onUploaded={onFaceUploaded} />
        </div>
        
  
        <div className="p-3 rounded-lg bg-white">
          <h3 className="text-lg font-medium">Body references</h3>
          <div className="text-gray-600 mb-2">Upload full-body references (T-pose or neutral full body)</div>
  
          <UploadAsset onUploaded={onBodyUploaded} label="Upload body image" />
  
          <div className="mt-3">
            {bodyUrls.length === 0 ? (
              <div className="text-gray-500">No body refs yet</div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {bodyUrls.map((u, i) => (
                  <div key={i} className="w-[160px]">
                    <img
                      src={u}
                      alt={`body-${i}`}
                      className="w-full h-[120px] object-cover rounded-md"
                    />
                    <div className="text-xs">{u.split("/").pop()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <label className="block mt-2.5 mb-1.5 font-medium h-[95px]">Base prompt (optional)</label>
        <textarea
          rows={3}
          className="w-full p-2 bg-normal-dark rounded-md h-full"
          value={basePrompt}
          onChange={(e) => setBasePrompt(e.target.value)}
        />

        <button
        onClick={() => {
            if (!subjectId) return alert("Create a subject first.");
            createModelSheet(subjectId);
        }}
        >
        Generate Model Sheet (4 body + 9 face previews)
        </button>

      <div className="mt-4">
        <button
          onClick={createSubject}
          disabled={isCreating}
          className="py-2 px-4 bg-default-orange text-white rounded-md hover:bg-blue-700 disabled:opacity-50 hover:cursor-pointer transition-all duration-150"
        >
          {isCreating ? "Creating…" : "Create Subject"}
        </button>
  
        {subjectId && (
          <button
            onClick={() => {
              stopPolling();
              startPollingStatus(subjectId);
            }}
            className="ml-2 py-2 px-4 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Refresh Status
          </button>
        )}
      </div>
  
      <div className="mt-4">
        <strong className="font-semibold">{message}</strong>
      </div>
  
      {/* status & assets */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-3 rounded-lg">
          <h3 className="text-lg font-medium">Subject Details</h3>
          {subject ? (
            <>
              <div><strong>ID:</strong> {subject.id}</div>
              <div><strong>Name:</strong> {subject.name}</div>
              <div><strong>Status:</strong> {subject.status}</div>
  
              <div className="mt-2">
                <h4 className="font-medium">Assets</h4>
                <div className="flex gap-2 flex-wrap mt-2">
                  {subject.assets?.length ? subject.assets.map((a, i) => (
                    <div key={i} className="w-[160px]">
                      <div className="text-xs text-gray-600 mb-1">
                        {a.type} {a.view ? `(${a.view})` : ""}
                      </div>
                      <img
                        src={a.url}
                        alt={a.type}
                        className="w-full h-[120px] object-cover rounded-md"
                      />
                    </div>
                  )) : <div className="text-gray-500">No assets yet</div>}
                </div>
              </div>
  
              <div className="mt-3">
                <h4 className="font-medium">Jobs</h4>
                <ul className="list-disc list-inside">
                  {subject.jobs?.map((j, idx) => <li key={idx}>{j.jobId} — {j.type} — {j.enqueuedAt}</li>)}
                </ul>
              </div>
  
              {subject.warnings?.length ? (
                <div className="mt-3 text-orange-600">
                  <strong>Warnings</strong>
                  <ul>{subject.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-gray-500">No subject selected / created yet</div>
          )}
        </div>
  
        <div className="bg-white p-3 rounded-lg lg:max-w-[360px]">
          <h3 className="text-lg font-medium">Generate Views</h3>
          <div className="text-sm text-gray-700">
            Pick views to auto-generate previews (preview-only — you must approve final images later)
          </div>
  
          <div className="mt-2">
            {Object.entries(selectedViews).map(([key, val]) => (
              <label key={key} className="block mt-1.5">
                <input
                  type="checkbox"
                  checked={val}
                  onChange={() => toggleView(key)}
                  className="mr-2"
                />
                {key}
              </label>
            ))}
          </div>
  
          <div className="mt-3">
            <button
              onClick={enqueueGenerateViews}
              disabled={isGenerating || !subjectId}
              className="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isGenerating ? "Queuing…" : "Generate Previews"}
            </button>
  
            <button
              onClick={approveSubject}
              disabled={!subjectId || (subject && subject.status === "ready")}
              className="ml-2 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Approve Subject (Ready)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
