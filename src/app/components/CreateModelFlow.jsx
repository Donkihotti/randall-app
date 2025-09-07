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

/*
  CreateModelFlow - expects optional prop initialName (string)
*/

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
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status }, [status]);

  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [polling, setPolling] = useState(false);
  const [localPreviewImages, setLocalPreviewImages] = useState([]); // [{url, meta}]

  // small refs used to protect UI transitions from poll overrides
  const previewForcedRef = useRef(null);     // timestamp until which preview is protected
  const lastEnqueueRef = useRef(null);       // timestamp of last enqueue
  const userLockRef = useRef(null);          // for user-initiated locks (upscaling etc)

  function lockTo(step, durationMs = 60000) {
    userLockRef.current = { step, until: Date.now() + durationMs };
  }
  function clearLock() { userLockRef.current = null; }
  function isLocked() { return userLockRef.current && userLockRef.current.until > Date.now(); }

  /**
   * mapServerStatus
   * Maps subject.status -> local UI step.
   *
   * NOTE: the order matters. 'generated' must be checked BEFORE the generic
   * `includes("generat")` check, otherwise "generated" incorrectly maps to generating-sheet.
   */
  function mapServerStatus(subjectObj) {
    if (!subjectObj) return null;
    const s = String(subjectObj.status || "").toLowerCase();

    // Draft / awaiting prompt -> open generate editor
    if (s === "awaiting-generation" || s === "draft" || s === "awaiting_prompt") return "generate";

    // queued / preprocessing -> validating step
    if (s === "queued" || s === "preprocess" || s === "preprocessing" || s === "queued_preprocess") return "validating";

    // final images generated / ready to use -> finalize / ready
    if (s === "generated" || s === "ready") return "ready";

    // when a worker is actively generating -> show generating-sheet
    // be specific (check for 'generating' or 'running' etc) — avoid matching 'generated'
    if (s === "generating" || s === "running" || s === "processing" || s.includes("queued_generation")) return "generating-sheet";
    // fallback: liberally match other "generation"-like states that are not "generated"
    if (s.includes("generat") && s !== "generated") return "generating-sheet";

    // previews ready / awaiting approval -> generate-preview
    // only map to preview if there are image assets present
    if (["awaiting-approval", "sheet_generated", "preview_ready"].includes(s)) {
      const assets = Array.isArray(subjectObj.assets) ? subjectObj.assets : [];
      const hasPreview = assets.some(a =>
        ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
      );
      if (hasPreview) return "generate-preview";
      return "generating-sheet";
    }

    // failed -> failed
    if (s === "failed" || s === "error") return "failed";

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

  // If initialName passed (from dashboard), prefill subject and stay in choose step
  useEffect(() => {
    if (initialName) {
      setSubject(prev => ({ ...(prev || {}), name: initialName }));
      setStatus("choose");
    }
  }, [initialName]);

  // Poll subject status (if we have an id) — stable interval that reads refs
  useEffect(() => {
    if (!subjectId) return;
    if (polling) return;
    setPolling(true);
    let mounted = true;

    const doPoll = async () => {
      try {
        const res = await getSubjectStatus(subjectId);
        if (!mounted) return;
        if (!res?.subject) return;

        // Debugging log (helpful)
        console.log("[poll] subjectId=", subjectId,
                    "serverStatus=", res.subject.status,
                    "lastEnqueue=", lastEnqueueRef.current,
                    "previewForcedUntil=", previewForcedRef.current,
                    "currentClientStatus=", statusRef.current);

        // update subject state
        setSubject(res.subject);

        const mapped = mapServerStatus(res.subject);
        if (!mapped) return;

        // Preview forced protection: if we forced preview, keep it until expiry or until server has persisted preview assets
        if (previewForcedRef.current && Date.now() < previewForcedRef.current) {
          const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
          const serverHasPreview = assets.some(a =>
            ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
          );
          if (serverHasPreview) {
            console.log("[poll] server has preview assets, clearing previewForcedRef");
            previewForcedRef.current = null;
            // allow mapping to continue
          } else {
            if (statusRef.current !== "generate-preview") {
              console.log("[poll] forced preview active -> set generate-preview");
              setStatus("generate-preview");
            }
            return; // do not let poll override
          }
        }

        // ignore brief regressions back to 'generate' immediately after we enqueued a job
        if (lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 8000)) {
          if (mapped === "generate" && (statusRef.current === "generating-sheet" || statusRef.current === "generate-preview")) {
            console.log("[poll] ignoring mapped back to generate during recent enqueue");
            return;
          }
        }

        // user-initiated lock handling
        if (isLocked()) {
          const lock = userLockRef.current;
          if (mapped === "failed" || mapped === "ready") {
            clearLock();
            console.log("[poll] overriding userLock due to critical mapped state:", mapped);
            setStatus(mapped);
            return;
          }
          if (mapped === lock.step) return;
          console.log("[poll] user lock active, ignoring mapping");
          return;
        }

        // avoid flash from generating->preview right after enqueue
        if (mapped === "generate-preview") {
          const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
          const hasPreview = assets.some(a => ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type));
          const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
          if (!hasPreview && recentlyEnqueued) {
            console.log("[poll] mapped=generate-preview but no assets and recently enqueued -> keep generating-sheet");
            setStatus("generating-sheet");
          } else {
            console.log("[poll] mapped=generate-preview -> set generate-preview");
            setStatus(mapped);
          }
          return;
        }

        // apply mapping normally if different
        if (mapped !== statusRef.current) {
          console.log("[poll] applying mapped status:", mapped);
          setStatus(mapped);
        }
      } catch (err) {
        console.error("[poll] error:", err);
      }
    };

    // run and schedule
    doPoll();
    const t = setInterval(doPoll, 2000);
    return () => { mounted = false; clearInterval(t); setPolling(false); };
  }, [subjectId]); // deliberate: only recreate poll when subjectId changes

  // helper to create subject
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

  // handle user picking "Upload references"
  function handlePickUpload() {
    clearLock();
    if (!subject?.name && !initialName) {
      showNotification("Missing model name — please provide a name before uploading", "error");
      return;
    }
    setStatus("uploading");
    showNotification("Upload references to build a consistent model", "info");
  }

  // handle user picking generate from scratch
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
                  onQueued={({ jobId, subjectId: sid, images = [], subject: returnedSubject, forcePreview = false }) => {
                    console.log("[onQueued] jobId:", jobId, "sid:", sid, "images.length:", images?.length, "forcePreview:", forcePreview);

                    setSubjectId(sid || subjectId);

                    // If server returned a subject row, merge it in
                    if (returnedSubject) {
                      setSubject(prev => ({ ...(prev || {}), ...returnedSubject }));
                    }

                    clearLock();

                    // If immediate images available — show them and go to preview
                    if (Array.isArray(images) && images.length > 0) {
                      const normalized = images.map(img => ({ url: img.url || img, meta: img.meta || {} }));
                      setLocalPreviewImages(normalized);

                      // merge preview assets locally so preview step can show them instantly
                      setSubject(prev => {
                        const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
                        const previewAssets = normalized.map(img => ({
                          type: 'preview', url: img.url, meta: img.meta || {}, created_at: new Date().toISOString()
                        }));
                        return { ...(prev || {}), assets: [...previewAssets, ...existing] };
                      });

                      // protect preview UI briefly
                      previewForcedRef.current = Date.now() + 10000;
                      // optionally set lastEnqueueRef so overlay logic still works
                      lastEnqueueRef.current = Date.now();
                      setStatus("generate-preview");
                      showNotification("Preview generated", "info");
                      return;
                    }

                    // Force preview requested (optimistic) — open preview screen and let poll fill images
                    if (forcePreview) {
                      setLocalPreviewImages([]); // start empty, poll will fill
                      previewForcedRef.current = Date.now() + 15000;
                      if (jobId) lastEnqueueRef.current = Date.now();
                      setStatus("generate-preview");
                      showNotification("Waiting for preview — opening preview screen", "info");
                      return;
                    }

                    // No immediate images: this is an async job, show generating overlay
                    if (jobId) {
                      lastEnqueueRef.current = Date.now();
                      setStatus("generating-sheet");
                      showNotification("Generation queued — waiting for previews", "info");
                      return;
                    }

                    // fallback: treat as started
                    lastEnqueueRef.current = Date.now();
                    setStatus("generating-sheet");
                    showNotification("Generation started", "info");
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
                  initialPreview={localPreviewImages}
                  showNotification={showNotification}
                  onBack={() => {
                    previewForcedRef.current = null;
                    clearLock();
                    if ((subject?.faceRefs && subject.faceRefs.length) || (subject?.bodyRefs && subject.bodyRefs.length)) {
                      setStatus("uploading");
                    } else {
                      setStatus("generate");
                    }
                  }}
                  onAccept={() => {
                    previewForcedRef.current = null;
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
