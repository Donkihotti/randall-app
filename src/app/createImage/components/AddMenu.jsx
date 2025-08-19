// components/AddMenu.jsx
import React from "react";
import { useGraph } from "./GraphContext";
import ButtonDefault from "@/app/components/ButtonDefault";

export default function AddMenu() {
  const { addComponent } = useGraph();

  return (
    <div style={{ padding: 8 }}>
      <h4>Add component</h4>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ButtonDefault onClick={() => addComponent("camera", { preset: "Studio Portrait", focal: 85, aspect: "4:5" })}>Camera</ButtonDefault>
        <ButtonDefault onClick={() => addComponent("subject", { subjectType: "person", pose: "neutral" })}>Subject</ButtonDefault>
        <ButtonDefault onClick={() => addComponent("clothing", { sku: "", imageRef: null, slot: "torso" })}>Clothing</ButtonDefault>
        <ButtonDefault onClick={() => addComponent("logo", { imageRef: null, opacity: 1.0, scale: 0.2 })}>Logo</ButtonDefault>
        <ButtonDefault onClick={() => addComponent("style", { feel: "studio" })}>StyleRef</ButtonDefault>
      </div>
    </div>
  );
}
