// src/components/BottomNotification.jsx
"use client";

export default function BottomNotification({ visible, message = "", type = "info" }) {
  if (!visible) return null;

  const base = "fixed left-1/2 transform -translate-x-1/2 bottom-6 z-50 px-4 py-3 rounded-md shadow-lg transition-all";
  const style =
    type === "error"
      ? "bg-red-600 text-white"
      : type === "warn"
      ? "bg-yellow-500 text-black"
      : "bg-neutral-900 text-white";

  return (
    <div role="status" className={`${base} ${style}`}>
      <div className="text-sm">{message}</div>
    </div>
  );
}
