import { useEffect, useRef } from "react";
import Image from "next/image";

export default function ImageModal({ src, alt = "", open, onClose }) {
  const overlayRef = useRef(null);
  const lastActiveRef = useRef(null);
  const imgRef = useRef(null);

  // Lock scroll, save/restore focus
  useEffect(() => {
    if (open) {
      lastActiveRef.current = document.activeElement;
      document.body.style.overflow = "hidden";
      // focus the image (or the overlay) for keyboard users
      setTimeout(() => imgRef.current?.focus?.(), 0);
    } else {
      document.body.style.overflow = "";
      try { lastActiveRef.current?.focus?.(); } catch (e) {}
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      // overlay click handler: close only if clicking the overlay itself
      onPointerDown={(e) => {
        // e.currentTarget is the overlay div; if target equals that, user clicked outside the image
        if (e.target === e.currentTarget) onClose?.();
      }}
      aria-modal="true"
      role="dialog"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* image container with simple appear/scale animation */}
      <div
        className="relative z-10 max-h-[90vh] max-w-[95vw] p-1 rounded"
        // stop pointer events from propagating from image container to overlay
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Image
          ref={imgRef}
          src={src}
          alt={alt}
          fill={true}
          tabIndex={0}
          className="block max-h-[90vh] max-w-[95vw] rounded shadow-lg transform transition duration-150 ease-out scale-95 opacity-0 animate-image-in"
          style={{ outline: "none" }}
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-20 bg-white/90 hover:bg-white text-black rounded-full p-1 shadow"
        >
          ✕
        </button>
      </div>

      <style>{`
        @keyframes imageIn {
          from { transform: scale(.96); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .animate-image-in { animation: imageIn 160ms ease-out forwards; }
      `}</style>
    </div>
  );
}
