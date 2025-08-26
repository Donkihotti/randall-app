"use client";

import Image from "next/image";
import React from "react";

export default function ButtonOrange({ children, text, type = "button", disabled = false, className = "", ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={rest.onClick}
      className={
        "bg-default-orange text-white rounded-xs px-6 py-1 transition-all duration-150 flex flex-row items-center gap-x-2 " +
        (disabled ? "opacity-60 cursor-not-allowed hover:bg-default-orange " : "hover:cursor-pointer hover:bg-orange-focus") +
        " " + className
      }
      {...rest}
    >
      {children || text}
      <Image src={"/arrow-long-right.svg"} alt="arrow long right" width={18} height={18} />
    </button>
  );
}