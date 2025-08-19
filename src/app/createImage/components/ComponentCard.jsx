// components/ComponentCard.jsx
import React from "react";
import { useGraph } from "./GraphContext";

export default function ComponentCard({ comp }) {
  const {
    selectedId,
    setSelectedId,
    startLink,
    linkModeSource,
    finishLink,
    removeComponent
  } = useGraph();

  const isSelected = selectedId === comp.id;
  const isLinkSource = linkModeSource === comp.id;

  // When the card itself is clicked:
  // - if we're currently in "link mode" (a source was chosen), finish the link here
  // - otherwise, just select the component
  function handleCardClick(e) {
    // prevent default if clicking the small inner buttons; card only
    // complete a link if active and clicking a different component
    if (linkModeSource) {
      if (linkModeSource === comp.id) {
        // clicked the same component that started linking -> cancel linking
        // simply clear link mode by starting link on same source again
        // (GraphContext.startLink toggles UI; we don't implement toggle here)
        setSelectedId(comp.id);
        return;
      }
      // finish link from linkModeSource -> this comp
      finishLink(comp.id);
      // select the target component so user can inspect the incoming link
      setSelectedId(comp.id);
      return;
    }

    // normal behavior: select the component
    setSelectedId(comp.id);
  }

  return (
    <div
      onClick={handleCardClick}
      style={{
        border: isSelected ? "2px solid #2563EB" : "1px solid #ddd",
        padding: 8,
        marginBottom: 8,
        borderRadius: 6,
        background: isLinkSource ? "#fffbeb" : "#fff",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>{comp.type}</strong>
          <div style={{ fontSize: 12, color: "#666" }}>{comp.id.slice(0, 6)}</div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {/* Link button starts link mode for this component */}
          <button
            onClick={(e) => {
              e.stopPropagation(); // avoid triggering card click
              startLink(comp.id);
            }}
            style={{
              background: isLinkSource ? "#f59e0b" : undefined,
              borderRadius: 6,
              padding: "6px 8px",
              cursor: "pointer"
            }}
            title={isLinkSource ? "Link mode active (click a target to finish)" : "Start linking from this component"}
          >
            {isLinkSource ? "Linking…" : "Link"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              removeComponent(comp.id);
            }}
            style={{ padding: "6px 8px", borderRadius: 6 }}
            className="hover:cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 13, color: "#444" }}>
        {Object.entries(comp.props || {}).slice(0, 3).map(([k, v]) => (
          <div key={k}><em>{k}</em>: {String(v)}</div>
        ))}
      </div>
    </div>
  );
}
