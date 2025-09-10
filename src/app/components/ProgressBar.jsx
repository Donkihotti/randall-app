"use client";

export default function ProgressBar({ steps = [], currentStatus = "" }) {
  const idx = Math.max(0, steps.indexOf(currentStatus));
  const pct = steps.length > 1 ? Math.round((idx / (steps.length - 1)) * 100) : 0;

  return (
    <div className="w-3xs bg-normal p-3.5 rounded-xs relative border border-light">
        <div className="bg-normal-dark w-fit px-3 py-0.5 rounded-xs absolute top-3.5 left-3.5">
        <p className="text-lighter text-supersmall">{currentStatus}</p>
        </div>
      <div className="mb-2 text-xs text-gray-400 flex items-center justify-end mt-2">
        <div className="text-xs text-gray-500">{pct}%</div>
      </div>

      <div className="w-full h-1 bg-normal-dark rounded overflow-hidden">
        <div className="h-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
