
import React from "react";
import ComponentCard from "./ComponentCard";
import { useGraph } from "./GraphContext";
import ToolMenu from "./ToolMenu";

export default function StageCanvas() {
  const { components, finishLink, linkModeSource } = useGraph();

  // When a card is clicked while link mode active, finishLink will be called by ComponentCard (or you could wire here)
  return (
    <div className="p-3 min-h-[400px] h-full bg-canvas relative">
      <div className="mb-2 text-gray-600 ">
        {components.length === 0 
        ? "Stage empty — add components" 
        : "Stage components"}
        </div>
      <div className="grid grid-cols-3 gap-2">
        {components.map(c => <ComponentCard key={c.id} comp={c} />)}
      </div>
      {linkModeSource && <div className="mt-2 text-amber-700">
        Linking mode active: click target component to finish
        </div>}
    </div>
  );
}
