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
          setSubject(res.subject);

          // map server status into a flow step
          const mapped = mapServerStatus(res.subject);
          if (!mapped) {
            // mapping returned null -> do nothing
            return;
          }

          // if user has locked the flow (they deliberately moved the client),
          // allow only critical server states to override the lock.
          if (isLocked()) {
            const lock = userLockRef.current;
            // allow "failed" or "ready" to override lock (these are critical)
            if (mapped === "failed" || mapped === "ready") {
              // clear lock and apply mapped
              clearLock();
              setStatus(mapped);
              return;
            }
            // If mapped is same as lock step, keep it (no-op). Otherwise ignore server mapping while locked.
            if (mapped === lock.step) {
              // keep user-chosen flow
              return;
            } else {
              // ignore mapping while locked
              return;
            }
          }

          // Special-case: avoid flashing from 'generating-sheet' -> 'generate-preview' right after enqueue
          if (mapped === "generate-preview") {
            const assets = Array.isArray(res.subject.assets) ? res.subject.assets : [];
            const hasPreview = assets.some(a => ["preview","sheet_face","sheet_body","generated_face_replicate","generated_face"].includes(a.type));
            const recentlyEnqueued = lastEnqueueRef.current && (Date.now() - lastEnqueueRef.current < 5000);
            if (!hasPreview && recentlyEnqueued) {
              setStatus("generating-sheet");
            } else {
              setStatus(mapped);
            }
            return;
          }

          // Otherwise apply mapping normally
          setStatus(mapped);
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
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "create subject failed");
      setSubjectId(j.subjectId);
      setSubject((prev) => ({ ...(prev || {}), id: j.subjectId, ...payload }));
      return j.subjectId;
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
                  onQueued={({ jobId, subjectId: sid }) => {
                    // when GenerateStep enqueues a job, update flow state -> show generating status
                    setSubjectId(sid || subjectId);
                    // record enqueue time so poll logic / overlay can use it (avoid flashes)
                    lastEnqueueRef.current = Date.now();
                    // clear any user lock because system generation is now underway
                    clearLock();
                    setStatus("generating-sheet");
                    showNotification("Generation queued — waiting for previews", "info");
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
