// components/GraphContext.js
import React, { createContext, useContext, useState } from "react";
import { v4 as uuidv4 } from "uuid";

const GraphContext = createContext();

export function useGraph() {
  return useContext(GraphContext);
}

export function GraphProvider({ children }) {
  const [components, setComponents] = useState([]); // array of component objects
  const [links, setLinks] = useState([]); // { fromId, toId, slot, transform }
  const [selectedId, setSelectedId] = useState(null);
  const [linkModeSource, setLinkModeSource] = useState(null); // for click-to-link

  function addComponent(type, props = {}) {
    const comp = {
      id: uuidv4(),
      type,
      props: { ...props }, // camera/subject/clothing/logo etc
    };
    setComponents(prev => [...prev, comp]);
    setSelectedId(comp.id);
    return comp;
  }

  function updateComponent(id, patch) {
    setComponents(prev => prev.map(c => c.id === id ? { ...c, props: { ...c.props, ...patch } } : c));
  }

  function removeComponent(id) {
    setComponents(prev => prev.filter(c => c.id !== id));
    setLinks(prev => prev.filter(l => l.fromId !== id && l.toId !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function startLink(fromId) {
    setLinkModeSource(fromId);
  }

  function finishLink(toId, slot = "default", transform = { x: 0.5, y: 0.5, scale: 1 }) {
    if (!linkModeSource) return;
    // Avoid linking to self
    if (linkModeSource === toId) {
      setLinkModeSource(null);
      return;
    }
    // push new link
    setLinks(prev => [...prev, { id: uuidv4(), fromId: linkModeSource, toId, slot, transform }]);
    setLinkModeSource(null);
  }

  function unlink(linkId) {
    setLinks(prev => prev.filter(l => l.id !== linkId));
  }

  function clear() {
    setComponents([]);
    setLinks([]);
    setSelectedId(null);
    setLinkModeSource(null);
  }

  return (
    <GraphContext.Provider value={{
      components, links, selectedId, linkModeSource,
      setSelectedId, addComponent, updateComponent, removeComponent,
      startLink, finishLink, unlink, clear
    }}>
      {children}
    </GraphContext.Provider>
  );
}
