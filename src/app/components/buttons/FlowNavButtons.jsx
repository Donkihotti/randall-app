"use client";
import React from "react";
import ButtonOrange from "./ButtonOrange";

export default function FlowNavButtons({
  onBack,
  onContinue,
  continueLabel = "Continue",
  backLabel = "Back",
  continueDisabled = false,
  backDisabled = false,
}) {
  return (
    <div className="flex items-center gap-3 mt-4">
      <button
        onClick={onBack}
        disabled={backDisabled}
        className="bg-normal text-white rounded-xs px-6 py-1 transition-all duration-150 flex flex-row items-center gap-x-2 "
        type="button"
      >
        {backLabel}
      </button>

      <ButtonOrange
        onClick={onContinue}
        disabled={continueDisabled}
        type="button"
      >
        {continueLabel}
      </ButtonOrange>
    </div>
  );
}
