"use client";

import PlusIconGray from "@/app/components/PlusIconGray";
import Link from "next/link";

export default function CreateBox({ text, href, onClick }) {
  const inner = (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="rounded-lg bg-normal w-52 h-42 flex flex-col gap-y-3 items-center justify-center hover:cursor-pointer border border-light hover:border hover:border-[#545454] focus:outline-none"
    >
      <PlusIconGray className="w-8 h-8 relative mt-3" />
      <p className="text-small text-[#7D7D7D]">{text}</p>
    </div>
  );

  if (href && !onClick) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}
