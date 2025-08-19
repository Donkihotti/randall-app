// lib/graphToPrompt.js
export function graphToPrompt(graph) {
    // graph: { components: [...], links: [...] }
    // Simple algorithm: get camera, subject, clothing (with linked logos), style
    const comps = graph.components || [];
    const links = graph.links || [];
  
    function find(type) { return comps.find(c => c.type === type); }
    const camera = find("camera");
    const subject = find("subject");
    const clothing = find("clothing");
    const style = find("style");
    // gather logos linked to clothing
    const logoLinks = links.filter(l => l.toId === (clothing && clothing.id)).map(l => {
      const logoComp = comps.find(c => c.id === l.fromId);
      return { logoComp, slot: l.slot, transform: l.transform };
    });
  
    const parts = [];
  
    if (camera) {
      const preset = camera.props.preset || "";
      const focal = camera.props.focal || camera.props.focal_length_mm || "";
      const aspect = camera.props.aspect || "";
      parts.push(`Camera: ${preset}${focal ? `, ${focal}mm` : ""}${aspect ? `, aspect ${aspect}` : ""}.`);
    } else {
      parts.push("Camera: studio portrait.");
    }
  
    if (subject) {
      const st = subject.props.subjectType || "person";
      const pose = subject.props.pose ? `, ${subject.props.pose}` : "";
      const face = subject.props.faceRef ? ` Use face reference: ${subject.props.faceRef}.` : "";
      parts.push(`Subject: ${st}${pose}.${face}`);
    } else {
      parts.push("Subject: person, neutral pose.");
    }
  
    if (clothing) {
      const sku = clothing.props.sku || "";
      const img = clothing.props.imageRef ? ` (image: ${clothing.props.imageRef})` : "";
      let clothText = `Clothing: ${sku}${img}, slot: ${clothing.props.slot || "torso"}.`;
      if (logoLinks.length) {
        const logosTxt = logoLinks.map(l => {
          const logoUrl = l.logoComp?.props?.imageRef || "logo";
          const scale = (l.logoComp?.props?.scale ?? l.transform?.scale) || 0.2;
          const opacity = l.logoComp?.props?.opacity ?? 1.0;
          return `Attach logo ${logoUrl} at ${l.slot} (scale ${scale}, opacity ${opacity})`;
        }).join("; ");
        clothText += " " + logosTxt + ".";
      }
      parts.push(clothText);
    }
  
    if (style) {
      const feel = style.props.feel || "studio";
      const styleRef = style.props.styleRef ? ` style ref: ${style.props.styleRef}` : "";
      parts.push(`Style: ${feel}.${styleRef}`);
    }
  
    // final directions
    parts.push("Render photorealistic, high detail. Emphasize fabric texture and realistic lighting. Avoid text in the scene. No visible watermark.");
  
    return parts.join(" ");
  }
  