// src/components/CreateModelFlow.jsx
"use client";

import { useEffect, useRef, useState } from "react";
import StartStep from "./steps/StartStep";
import UploadStep from "./steps/UploadStep";
import GenerateSheetStep from "./steps/GenerateSheetStep";
import UpscaleStep from "./steps/UpscaleStep";
import FinalizeStep from "./steps/FinalizeStep";
import ProgressBar from "./ProgressBar";
import BottomNotification from "./BottomNotification";
import { getSubjectStatus } from "../../../lib/apiClient";

export default function CreateModelFlow() {
  // canonical statuses used in progress bar; keep this in sync with subject.status
  const STEPS = [
    "start",
    "uploading",
    "validating",
    "awaiting-approval",
    "sheet-preview",
    "upscaling",
    "finalize",
    "ready",
  ];

  const [status, setStatus] = useState("start");
  const [subjectId, setSubjectId] = useState(null);
  const [subject, setSubject] = useState(null);
  const [polling, setPolling] = useState(false);

  // notification state
  const [notif, setNotif] = useState({ visible: false, message: "", type: "info" });
  const notifTimerRef = useRef(null);

  // helper: show notification (auto-dismiss after 4s)
  function showNotification(message, type = "info", timeoutMs = 4000) {
    if (notifTimerRef.current) {
      clearTimeout(notifTimerRef.current);
      notifTimerRef.current = null;
    }
    setNotif({ visible: true, message, type });
    notifTimerRef.current = setTimeout(() => {
      setNotif((p) => ({ ...p, visible: false }));
      notifTimerRef.current = null;
    }, timeoutMs);
  }

  useEffect(() => {
    // cleanup timer on unmount
    return () => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    };
  }, []);

  // Poll subject status (if we have an id)
  useEffect(() => {
    if (!subjectId) return;
    if (polling) return; // already polling
    setPolling(true);
    let mounted = true;

    const doPoll = async () => {
      try {
        const res = await getSubjectStatus(subjectId);
        if (res?.subject && mounted) {
          setSubject(res.subject);
          // keep UI state in sync with server status if available
          if (res.subject.status) setStatus(res.subject.status);
        }
      } catch (err) {
        console.error("poll error", err);
      }
    };

    // initial + interval
    doPoll();
    const t = setInterval(doPoll, 2000);
    return () => {
      mounted = false;
      clearInterval(t);
      setPolling(false);
    };
  }, [subjectId]);

  // handle start -> upload transition
  function handleStartNext(payload) {
    // payload expected shape: { name, basePrompt?, consent? }
    console.log("handleStartNext called with payload:", payload);
    const name = payload?.name || "";
    const basePrompt = payload?.basePrompt || "";
    const consent = payload?.consent ?? false;

    // validate here and show inline notification if needed
    if (!name) {
      showNotification("Add a name before proceeding", "error");
      return;
    }

    setSubject({ name, basePrompt, consent });
    setStatus("uploading");
    showNotification("Now upload references for this model", "info");
  }

  function handleSubjectCreated(created) {
    // created expected to be { subjectId } or { ok, subjectId }
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

  // Render and pass showNotification to all steps so they can show warnings/errors
  const stepProps = {
    subjectId,
    subject,
    setStatus,
    showNotification,
  };

  return (
    <div className="w-full mx-auto h-full">
      <div className="absolute top-3.5 left-3.5">
        <ProgressBar steps={STEPS} currentStatus={status} />
      </div>

      <div className="h-full w-full flex items-center">
        {(() => {
          switch (status) {
            case "start":
              return <StartStep onNext={handleStartNext} {...stepProps} />;

            case "uploading":
            case "validating":
              return <UploadStep initialSubject={subject} onCreated={handleSubjectCreated} {...stepProps} />;

            case "awaiting-approval":
            case "ready-to-generate":
            case "generating-sheet":
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

      {/* Bottom notification (auto-dismiss) */}
      <BottomNotification visible={notif.visible} message={notif.message} type={notif.type} />
    </div>
  );
}
