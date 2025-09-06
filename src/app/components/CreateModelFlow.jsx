// src/components/CreateModelFlow.jsx (or src/app/... replace existing CreateModelFlow)
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import UploadStep from "./steps/UploadStep";
import GenerateSheetStep from "./steps/GenerateSheetStep";
import GenerateStep from "./steps/GenerateStep";
import UpscaleStep from "./steps/UpscaleStep";
import FinalizeStep from "./steps/FinalizeStep";
import ProgressBar from "./ProgressBar";
import BottomNotification from "./BottomNotification";
import ChoiceStep from "./steps/ChoiceStep";
import GeneratePreviewStep from "./steps/GeneratePreviewStep";
import { getSubjectStatus } from "../../../lib/apiClient";

export default function CreateModelFlow({ initialName = "" }) {
  const router = useRouter();

  const STEPS = [
    "choose",
    "generate",
    "generate-preview",
    "uploading",
    "validating",
    "generating-sheet",
    "sheet-preview",
    "upscaling",
    "finalize",
    "ready",
  ];

  const [status, setStatus] = useState("choose");
  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [polling, setPolling] = useState(false);
  const [localPreviewImages, setLocalPreviewImages] = useState([]); // [{url, meta}]

  const previewForcedRef = useRef(null);
  const lastEnqueueRef = useRef(null);
  const userLockRef = useRef(null);

  function lockTo(step, durationMs = 60000) {
    userLockRef.current = { step, until: Date.now() + durationMs };
  }
  function clearLock() {
    userLockRef.current = null;
  }
  function isLocked() {
    return userLockRef.current && userLockRef.current.until > Date.now();
  }

  function mapServerStatus(subjectObj) {
    if (!subjectObj) return null;
    const s = String(subjectObj.status || "").toLowerCase();

    // final images generated / ready to use -> finalize / ready  (check exact 'generated' first)
    if (s === "generated" || s === "ready") return "ready";

    // failed -> failed
    if (s === "failed" || s === "error") return "failed";

    // Draft / awaiting prompt -> open generate editor
    if (s === "awaiting-generation" || s === "draft" || s === "awaiting_prompt") return "generate";

    // queued / preprocessing -> validating step
    if (s === "queued" || s === "preprocess" || s === "preprocessing" || s === "queued_preprocess") return "validating";

    // when worker is generating -> show generating-sheet
    if (s.includes("generat") || s === "running" || s === "processing" || s === "generating" || s.includes("queued_generation")) return "generating-sheet";

    // previews ready / awaiting approval -> generate-preview
    if (["awaiting-approval", "sheet_generated", "preview_ready"].includes(s)) {
      const assets = Array.isArray(subjectObj.assets) ? subjectObj.assets : [];
      const hasPreview = assets.some(a =>
        ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
      );
      if (hasPreview) return "generate-preview";
      return "generating-sheet";
    }

    // fallback: if server status already matches a flow key, use it
    if (["choose","generate","uploading","validating","generating-sheet","sheet-preview","upscaling","finalize","ready","failed"].includes(s)) {
      return s;
    }

    return null;
  }

  // notifications
  const [notif, setNotif] = useState({ visible: false, message: "", type: "info" });
  const notifTimerRef = useRef(null);
  function showNotification(message, type = "info", timeoutMs = 4000) {
    if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    setNotif({ visible: true, message, type });
    notifTimerRef.current = setTimeout(() => setNotif((p) => ({ ...p, visible: false })), timeoutMs);
  }
  useEffect(() => () => { if (notifTimerRef.current) clearTimeout(notifTimerRef.current); }, []);

  useEffect(() => {
    if (initialName) {
      setSubject(prev => ({ ...(prev || {}), name: initialName }));
      setStatus("choose");
    }
  }, [initialName]);

  // Poll subject status (if we have an id)
  useEffect(() => {
    if (!subjectId) return;
    if (polling) return;
    setPolling(true);
    let mounted = true;

    const doPoll = async () => {
      try {
        const res = await getSubjectStatus(subjectId);
        if (res?.subject && mounted) {
          console.log("[poll] subjectId=", subjectId,
                      "serverStatus=", res.subject.status,
                      "lastEnqueue=", lastEnqueueRef.current,
                      "previewForcedUntil=", previewForcedRef.current,
                      "currentClientStatus=", status);

          setSubject(res.subject);

          const mapped = mapServerStatus(res.subject);
          if (!mapped) {
            console.log("[poll] mapServerStatus returned null — no action");
            return;
          }

          // previewForcedRef check FIRST (protect preview UI)
          if (previewForcedRef.current && Date.now() < previewForcedRef.current) {
            console.log("[poll] previewForcedRef ACTIVE - protecting generate-preview UI");
            const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
            const serverHasPreview = assets.some(a =>
              ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
            );
            if (serverHasPreview) {
              console.log("[poll] server HAS preview assets -> clearing previewForcedRef to resume normal mapping");
              previewForcedRef.current = null;
              // allow mapping to proceed
            } else {
              if (status !== "generate-preview") {
                console.log("[poll] forcing client status -> generate-preview");
                setStatus("generate-preview");
              }
              return;
            }
          }

          // user lock
          if (isLocked()) {
            const lock = userLockRef.current;
            console.log("[poll] userLock active:", lock);
            if (mapped === "failed" || mapped === "ready") {
              clearLock();
              console.log("[poll] overriding userLock due to critical mapped state:", mapped);
              setStatus(mapped);
              return;
            }
            if (mapped === lock.step) {
              console.log("[poll] mapped === lock.step, keeping user lock");
              return;
            }
            console.log("[poll] userLock exists and mapped != lock.step -> ignoring server mapping");
            return;
          }

          // Avoid flashing from generating-sheet -> generate-preview if we just enqueued
          if (mapped === "generate-preview") {
            const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
            const hasPreview = assets.some(a => ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type));
            const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
            if (!hasPreview && recentlyEnqueued) {
              console.log("[poll] mapped=generate-preview but no assets and recently enqueued -> keep generating-sheet");
              setStatus("generating-sheet");
            } else {
              console.log("[poll] mapped=generate-preview -> setting generate-preview");
              setStatus(mapped);
            }
            return;
          }

          if (mapped !== status) {
            console.log("[poll] applying mapped status:", mapped);
            setStatus(mapped);
          }
        }
      } catch (err) {
        console.error("poll error", err);
      }
    };

    doPoll();
    const t = setInterval(doPoll, 2000);
    return () => { mounted = false; clearInterval(t); setPolling(false); };
  }, [subjectId, status]);

  async function createSubjectIfNeeded(options = {}) {
    if (subjectId) return subjectId;
    try {
      const payload = {
        name: subject?.name || initialName || "Unnamed model",
        consentConfirmed: !!subject?.consent,
        basePrompt: subject?.basePrompt || "",
        draft: !!options.draft,
      };
  
      const res = await fetch("/api/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
  
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "create subject failed");
  
      const returnedSubject = j.subject || j.data || null;
      if (!returnedSubject || !returnedSubject.id) {
        const sid = j.subjectId || j.id || j.subject_id;
        if (!sid) throw new Error("Server did not return new subject id");
        setSubjectId(sid);
        setSubject((prev) => ({ ...(prev || {}), id: sid, ...payload }));
        return sid;
      }
  
      setSubjectId(returnedSubject.id);
      setSubject((prev) => ({ ...(prev || {}), id: returnedSubject.id, ...payload }));
      return returnedSubject.id;
    } catch (err) {
      console.error("createSubjectIfNeeded failed", err);
      showNotification("Failed to create subject: " + (err.message || err), "error");
      throw err;
    }
  }

  function handlePickUpload() {
    clearLock();
    if (!subject?.name && !initialName) {
      showNotification("Missing model name — return to dashboard and add a name", "error");
      return;
    }
    setStatus("uploading");
    showNotification("Upload references to build a consistent model", "info");
  }

  async function handlePickGenerate() {
    clearLock();
    try {
      showNotification("Preparing prompt page...", "info");
      const id = await createSubjectIfNeeded({ draft: true });
      setStatus("generate");
      showNotification("Open the prompt editor to generate references", "info");
    } catch (err) {
      console.error("handlePickGenerate error", err);
      showNotification("Failed to start generate flow: " + (err.message || err), "error");
    }
  }

  function handleSubjectCreated(created) {
    clearLock();
    console.log("handleSubjectCreated", created);
    if (created?.subjectId) {
      setSubjectId(created.subjectId);
      setStatus("validating");
      showNotification("Subject created — validating uploads", "info");
      return;
    }
    if (created?.subject?.id) {
      setSubjectId(created.subject.id);
      setSubject(created.subject);
      setStatus(created.subject.status || "validating");
      showNotification("Subject created", "info");
    }
  }

  const stepProps = { subjectId, subject, setStatus, showNotification };

  const showGeneratingOverlay = (() => {
    const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
    return status === "generating-sheet" || recentlyEnqueued;
  })();

  return (
    <div className="w-full mx-auto h-full">
      <div className="absolute top-3.5 left-3.5">
        <ProgressBar steps={STEPS} currentStatus={status} />
      </div>

      {showGeneratingOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
          <div className="text-center text-white px-6">
            <div className="mb-4 text-lg font-medium">Generating images…</div>
            <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      )}

      <div className="h-full w-full flex items-center">
        {(() => {
          switch (status) {
            case "choose":
              return <ChoiceStep subject={subject} onPickUpload={handlePickUpload} onPickGenerate={handlePickGenerate} showNotification={showNotification} />;

            case "generate":
              return (
                <GenerateStep
                  subjectId={subjectId}
                  name={subject?.name || initialName}
                  showNotification={showNotification}
                  onQueued={async ({ jobId, subjectId: sid, images = [], subject: returnedSubject }) => {
                    console.log("[onQueued]", { jobId, sid, images, returnedSubject });
                    const sidFinal = sid || subjectId;
                    setSubjectId(sidFinal);

                    if (returnedSubject) {
                      setSubject(prev => ({ ...(prev || {}), ...returnedSubject }));
                    }

                    // record enqueue time
                    lastEnqueueRef.current = Date.now();
                    clearLock();

                    // If child returned immediate images, use those instantly
                    if (Array.isArray(images) && images.length > 0) {
                      const normalized = images.map((img) => ({ url: img.url || img, meta: img.meta || {} }));
                      setLocalPreviewImages(normalized);
                      setSubject(prev => {
                        const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
                        const previewAssets = normalized.map(img => ({
                          type: 'preview',
                          url: img.url,
                          meta: img.meta || {},
                          created_at: new Date().toISOString()
                        }));
                        return { ...(prev || {}), assets: [...previewAssets, ...existing] };
                      });
                      // show preview immediately
                      setStatus("generate-preview");
                      // protect preview UI briefly
                      previewForcedRef.current = Date.now() + 10000;
                      showNotification("Preview generated", "info");
                      return;
                    }

                    // No immediate images: try to fetch the updated subject quickly (fast-poll)
                    // We will poll /api/subject/:id/status directly for up to timeoutMs to pick up worker-persisted assets.
                    const timeoutMs = 12000; // how long we'll wait for assets
                    const intervalMs = 1000;
                    const start = Date.now();
                    let foundAssets = null;
                    try {
                      while (Date.now() - start < timeoutMs) {
                        try {
                          const res = await getSubjectStatus(sidFinal);
                          if (res?.subject) {
                            setSubject(res.subject);
                          const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
                            const previewAssets = assets.filter(a => a.url).map(a => ({ url: a.url, meta: a.meta || {} }));
                            if (previewAssets.length > 0) {
                              foundAssets = previewAssets;
                              break;
                          }
                          }
                        } catch (err) {
                          console.warn("fast-check subject status failed:", err);
                      }
                        // small delay
                        await new Promise(r => setTimeout(r, intervalMs));
                      }
                    } catch (e) {
                      console.warn("fast poll loop failed", e);
                    }

                    if (foundAssets && foundAssets.length > 0) {
                      // display preview and protect UI briefly
                      setLocalPreviewImages(foundAssets);
                      setStatus("generate-preview");
                      previewForcedRef.current = Date.now() + 10000;
                      showNotification("Preview available", "info");
                      return;
                    }

                    // fallback: no assets found quickly -> show generating overlay and let main poll continue
                    if (jobId) {
                      setStatus("generating-sheet");
                      showNotification("Generation queued — waiting for previews", "info");
                      return;
                    }

                    // final fallback: show generating state
                    setStatus("generating-sheet");
                    showNotification("Generation started — waiting for previews", "info");
                  }}
                />
              );

            case "uploading":
            case "validating":
              return <UploadStep initialSubject={subject} onCreated={handleSubjectCreated} {...stepProps} />;

            case "generating-sheet":
              return <GenerateSheetStep {...stepProps} />;

            case "generate-preview":
              return (
                <GeneratePreviewStep
                  subject={subject}
                  subjectId={subjectId}
                  showNotification={showNotification}
                  initialPreview={localPreviewImages}
                  onBack={() => {
                    clearLock();
                    if ((subject?.faceRefs && subject.faceRefs.length) || (subject?.bodyRefs && subject.bodyRefs.length)) {
                      setStatus("uploading");
                    } else {
                      setStatus("generate");
                    }
                  }}
                  onAccept={() => {
                    lockTo("upscaling", 60000);
                    setStatus("upscaling");
                    showNotification("Accepted preview — moving to upscaling", "info");
                  }}
                />
              );

            case "sheet-preview":
              return <GenerateSheetStep {...stepProps} />;

            case "upscaling":
              return <UpscaleStep {...stepProps} />;

            case "finalize":
            case "ready":
              return <FinalizeStep {...stepProps} />;

            case "failed":
              return (
                <div className="p-4 text-red-600">
                  Something failed. Check logs and subject warnings.
                </div>
              );

            default:
              return null;
          }
        })()}
      </div>

      <BottomNotification visible={notif.visible} message={notif.message} type={notif.type} />
    </div>
  );
}
