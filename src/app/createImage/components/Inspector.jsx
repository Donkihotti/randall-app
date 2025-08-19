// components/Inspector.jsx
import React from "react";
import { useGraph } from "./GraphContext";

export default function Inspector() {
  const { components, selectedId, updateComponent, links, startLink, finishLink, unlink } = useGraph();
  const comp = components.find(c => c.id === selectedId);
  if (!comp) return <div style={{ padding: 12 }}>Select a component to edit</div>;

  function setProp(key, val) {
    updateComponent(comp.id, { [key]: val });
  }

  return (
    <div style={{ padding: 12, borderLeft: "1px solid #eee", minWidth: 300 }}>
      <h3>{comp.type} — {comp.id.slice(0,6)}</h3>

      {/* Render simple forms depending on type */}
      {comp.type === "camera" && (
        <>
          <label>Preset</label>
          <input value={comp.props.preset || ""} onChange={e => setProp("preset", e.target.value)} />
          <label>Focal (mm)</label>
          <input type="number" value={comp.props.focal || 50} onChange={e => setProp("focal", Number(e.target.value))} />
          <label>Aspect</label>
          <input value={comp.props.aspect || "1:1"} onChange={e => setProp("aspect", e.target.value)} />
        </>
      )}

      {comp.type === "subject" && (
        <>
          <label>Subject Type</label>
          <select value={comp.props.subjectType} onChange={e => setProp("subjectType", e.target.value)}>
            <option>person</option><option>product</option><option>scene</option>
          </select>
          <label>Pose</label>
          <input value={comp.props.pose || ""} onChange={e => setProp("pose", e.target.value)} />
          <label>FaceRef URL (optional)</label>
          <input value={comp.props.faceRef || ""} onChange={e => setProp("faceRef", e.target.value)} placeholder="https://..." />
        </>
      )}

      {comp.type === "clothing" && (
        <>
          <label>SKU/Label</label>
          <input value={comp.props.sku || ""} onChange={e => setProp("sku", e.target.value)} />
          <label>Image URL</label>
          <input value={comp.props.imageRef || ""} onChange={e => setProp("imageRef", e.target.value)} placeholder="https://..." />
          <label>Slot</label>
          <select value={comp.props.slot || "torso"} onChange={e => setProp("slot", e.target.value)}>
            <option value="torso">torso</option><option value="sleeve">sleeve</option><option value="collar">collar</option>
          </select>
        </>
      )}

      {comp.type === "logo" && (
        <>
          <label>Logo URL</label>
          <input value={comp.props.imageRef || ""} onChange={e => setProp("imageRef", e.target.value)} placeholder="https://..." />
          <label>Opacity</label>
          <input type="range" min="0.1" max="1" step="0.05" value={comp.props.opacity || 1} onChange={e => setProp("opacity", Number(e.target.value))} />
          <label>Scale</label>
          <input type="range" min="0.05" max="1" step="0.01" value={comp.props.scale || 0.2} onChange={e => setProp("scale", Number(e.target.value))} />
        </>
      )}

      {comp.type === "style" && (
        <>
          <label>Feel</label>
          <select value={comp.props.feel || "studio"} onChange={e => setProp("feel", e.target.value)}>
            <option value="studio">studio</option><option value="iphone">iphone</option><option value="editorial">editorial</option>
          </select>
          <label>Style ref URL</label>
          <input value={comp.props.styleRef || ""} onChange={e => setProp("styleRef", e.target.value)} placeholder="https://..." />
        </>
      )}

      <hr style={{ margin: "12px 0" }} />

      <div>
        <h4>Links (incoming)</h4>
        {links.filter(l => l.toId === comp.id).map(l => (
          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 13 }}>{l.fromId.slice(0,6)} → slot: {l.slot}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => unlink(l.id)}>Unlink</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <em>Tip:</em> click “Link” on a component card, then click the target component card to finish linking.
      </div>
    </div>
  );
}
