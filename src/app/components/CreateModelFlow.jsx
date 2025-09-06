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
  Flow:
    - choose  (upload refs or generate-from-scratch)
    - generate (prompt editor)
    - generating-sheet (worker running)
    - generate-preview (show previews, accept/edit/back)
    - uploading / validating (upload references flow)
    - upscaling
    - finalize / ready
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
  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [polling, setPolling] = useState(false);
  const [localPreviewImages, setLocalPreviewImages] = useState([]); // [{url, meta}]

  const previewForcedRef = useRef(null);

  // local ref to track when the client enqueued a job (avoid flash-overrides)
  const lastEnqueueRef = useRef(null);

  // user lock: prevents poll from stomping a user-initiated transition
  // structure: { step: "upscaling", until: timestamp }
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

  // -----------------------------------------
  // map server-side subject.status -> local flow step
  // -----------------------------------------

  function mapServerStatus(subjectObj) {
    if (!subjectObj) return null;
    const s = String(subjectObj.status || "").toLowerCase();

    // Draft / awaiting prompt -> open generate editor
    if (s === "awaiting-generation" || s === "draft" || s === "awaiting_prompt") return "generate";

    // queued / preprocessing -> validating step
    if (s === "queued" || s === "preprocess" || s === "preprocessing" || s === "queued_preprocess") return "validating";

    // when worker is generating -> show generating-sheet
    if (s.includes("generat") || s === "running" || s === "processing" || s === "generating" || s.includes("queued_generation")) return "generating-sheet";

    // previews ready / awaiting approval -> generate-preview
    // only map to preview if there are image assets present
    if (["awaiting-approval", "sheet_generated", "preview_ready"].includes(s)) {
      const assets = Array.isArray(subjectObj.assets) ? subjectObj.assets : [];
      const hasPreview = assets.some(a =>
        ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
      );
      if (hasPreview) return "generate-preview";
      // if there are no assets yet, prefer "generating-sheet" to show progress
      return "generating-sheet";
    }

    // final images generated / ready to use -> finalize / ready
    if (s === "generated" || s === "ready") return "ready";

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
        // Debug logging: helps see what poll sees and why it maps step
        console.log("[poll] subjectId=", subjectId,
                    "serverStatus=", res.subject.status,
                    "lastEnqueue=", lastEnqueueRef.current,
                    "previewForcedUntil=", previewForcedRef.current,
                    "currentClientStatus=", status);

        setSubject(res.subject);

        // map server status into a flow step
        const mapped = mapServerStatus(res.subject);
        if (!mapped) {
          // mapping returned null -> do nothing
          console.log("[poll] mapServerStatus returned null — no action");
          return;
        }

        // --- NEW: previewForcedRef check FIRST ---
        if (previewForcedRef.current && Date.now() < previewForcedRef.current) {
          // If the client forced a preview, keep the preview UI until lock expires
          console.log("[poll] previewForcedRef ACTIVE - protecting generate-preview UI");
          // If server already has preview assets persisted, let poll clear the forced ref
          const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
          const serverHasPreview = assets.some(a =>
            ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type)
          );
          if (serverHasPreview) {
            console.log("[poll] server HAS preview assets -> clearing previewForcedRef to resume normal mapping");
            previewForcedRef.current = null;
            // allow mapping to proceed below (fall-through)
          } else {
            // keep the client in preview step
            if (status !== "generate-preview") {
              console.log("[poll] forcing client status -> generate-preview");
              setStatus("generate-preview");
            }
            return; // do not let poll override
          }
        }

        // if user has locked the flow (they deliberately moved the client),
        // allow only critical server states to override the lock.
        if (isLocked()) {
          const lock = userLockRef.current;
          console.log("[poll] userLock active:", lock);
          // allow "failed" or "ready" to override lock (these are critical)
          if (mapped === "failed" || mapped === "ready") {
            // clear lock and apply mapped
            clearLock();
            console.log("[poll] overriding userLock due to critical mapped state:", mapped);
            setStatus(mapped);
            return;
          }
          // If mapped is same as lock step, keep it (no-op). Otherwise ignore server mapping while locked.
          if (mapped === lock.step) {
            console.log("[poll] mapped === lock.step, keeping user lock");
            return;
          }
          console.log("[poll] userLock exists and mapped != lock.step -> ignoring server mapping");
          return;
        }

        // Special-case: avoid flashing from 'generating-sheet' -> 'generate-preview' right after enqueue
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

        // Otherwise apply mapping normally
        if (mapped !== status) {
          console.log("[poll] applying mapped status:", mapped);
          setStatus(mapped);
        } else {
          // no-op
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

  // helper to create subject if it's not created yet
  async function createSubjectIfNeeded(options = {}) {
    if (subjectId) return subjectId;
    try {
      const payload = {
        name: subject?.name || initialName || "Unnamed model",
        consentConfirmed: !!subject?.consent,
        basePrompt: subject?.basePrompt || "",
        // pass explicit draft flag so server can skip strict validation
        draft: !!options.draft,
      };
  
      const res = await fetch("/api/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // ← critical: send auth cookies
        body: JSON.stringify(payload),
      });
  
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "create subject failed");
  
      // server returns { ok: true, subject, job }
      const returnedSubject = j.subject || j.data || null;
      if (!returnedSubject || !returnedSubject.id) {
        // defensive fallback: check for subjectId
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
      showNotification("Missing model name — return to dashboard and add a name", "error");
      return;
    }
    setStatus("uploading");
    showNotification("Upload references to build a consistent model", "info");
  }

  // handle user picking "Generate from scratch"
  async function handlePickGenerate() {
    clearLock();
    try {
      showNotification("Preparing prompt page...", "info");

      // create a DRAFT subject (server must accept draft: true)
      const id = await createSubjectIfNeeded({ draft: true });

      // open the Generate step
      setStatus("generate");
      showNotification("Open the prompt editor to generate references", "info");
    } catch (err) {
      console.error("handlePickGenerate error", err);
      showNotification("Failed to start generate flow: " + (err.message || err), "error");
    }
  }

  // Handler when UploadStep creates subject
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

  // small helper to decide if we should show a full-screen generating overlay
  const showGeneratingOverlay = (() => {
    const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
    return status === "generating-sheet" || recentlyEnqueued;
  })();

  return (
    <div className="w-full mx-auto h-full">
      <div className="absolute top-3.5 left-3.5">
        <ProgressBar steps={STEPS} currentStatus={status} />
      </div>

      {/* Generating Overlay */}
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
                  onQueued={({ jobId, subjectId: sid, images = [], subject: returnedSubject }) => {
                    console.log('[onQueued]', { jobId, sid, images, returnedSubject });
                  
                    setSubjectId(sid || subjectId);
                  
                    // If server returned subject, merge it
                    if (returnedSubject) {
                      setSubject(prev => ({ ...(prev||{}), ...returnedSubject }));
                    }
                  
                    lastEnqueueRef.current = Date.now();
                    clearLock();
                  
                    // Always open preview UI and protect it briefly
                    setStatus('generate-preview');
                    const lockDurationMs = 10000;
                    previewForcedRef.current = Date.now() + lockDurationMs;
                  
                    if (Array.isArray(images) && images.length > 0) {
                      // normalize images
                      const normalized = images.map((img) => ({ url: img.url || img, meta: img.meta || {} }));
                      // show immediate preview
                      setLocalPreviewImages(normalized);
                  
                      // merge into local subject.assets for preview display
                      setSubject(prev => {
                        const existing = Array.isArray(prev?.assets) ? prev.assets.slice() : [];
                        const previewAssets = normalized.map(img => ({
                          type: 'preview',
                          url: img.url,
                          meta: img.meta || {},
                          created_at: new Date().toISOString()
                        }));
                        return { ...(prev||{}), assets: [...previewAssets, ...existing] };
                      });
                    }
                  
                    showNotification(jobId ? 'Generation queued — opening preview' : 'Preview generated', 'info');
                  }}
                />
                );

            case "uploading":
            case "validating":
              return <UploadStep initialSubject={subject} onCreated={handleSubjectCreated} {...stepProps} />;

            case "generating-sheet":
              // worker running; keep user informed with GenerateSheetStep (you already have it)
              return <GenerateSheetStep {...stepProps} />;

            // RENDER THE NEW PREVIEW STEP: "generate-preview"
            case "generate-preview":
              return (
                <GeneratePreviewStep
                  subject={subject}
                  subjectId={subjectId}
                  showNotification={showNotification}
                  initialPreview={localPreviewImages}
                  onBack={() => {
                    clearLock();
                    // go back to upload or generate depending on presence of references
                    if ((subject?.faceRefs && subject.faceRefs.length) || (subject?.bodyRefs && subject.bodyRefs.length)) {
                      setStatus("uploading");
                    } else {
                      setStatus("generate");
                    }
                  }}
                  onAccept={() => {
                    // accepted preview -> advance to next step (upscaling here)
                    // lock the flow for a while so the poll doesn't immediately stomp it
                    lockTo("upscaling", 60000); // 60s lock
                    setStatus("upscaling");
                    showNotification("Accepted preview — moving to upscaling", "info");
                  }}
                />
              );

            case "sheet-preview":
              // backward-compatible case if something still sets 'sheet-preview'
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
