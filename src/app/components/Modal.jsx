"use client";

import { useEffect, useRef } from "react";

export default function Modal({ open, onClose, title, children, ariaLabel }) {
  const overlayRef = useRef(null);
  const modalRef = useRef(null); // <-- content ref
  const lastActiveRef = useRef(null);

  useEffect(() => {
    if (open) {
      lastActiveRef.current = document.activeElement;
      setTimeout(() => overlayRef.current?.focus?.(), 0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      try { lastActiveRef.current?.focus?.(); } catch (e) {}
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && open) onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      aria-label={ariaLabel || title || "modal"}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      // Use pointerdown so it works better on touch devices;
      // handler checks whether click was outside modalRef
      onPointerDown={(e) => {
        if (modalRef.current && !modalRef.current.contains(e.target)) {
          onClose?.();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 " />

      <div ref={modalRef} className="relative z-10 max-w-2xl w-full">
        <div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
