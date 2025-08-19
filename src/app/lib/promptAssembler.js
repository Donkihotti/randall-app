
function shortName(url) {
    try { return url.split("/").pop(); } catch (e) { return url; }
  }
  
  function cameraSummary(cam) {
    if (!cam) return "Default studio camera";
    const parts = [];
    if (cam.preset) parts.push(`${cam.preset}`);
    if (cam.focal_length_mm) parts.push(`${cam.focal_length_mm}mm`);
    if (cam.aperture) parts.push(`f/${cam.aperture}`);
    if (cam.aspect_ratio) parts.push(`aspect ${cam.aspect_ratio}`);
    return `Camera: ${parts.join(", ")}`;
  }
  
  function styleSummary(style) {
    if (!style) return "Neutral studio lighting.";
    const feel = style.feel ? `${style.feel} look.` : "";
    const refs = (style.style_ref_urls || []).slice(0,2).map(u => `ref:${shortName(u)}`).join(", ");
    return `${feel} Style references: ${refs}.`;
  }
  
  function assemblePrompt(json) {
    if (!json) return "Studio portrait, photorealistic.";
  
    if (json.instructions && json.instructions.prompt_text) {
      return `${json.instructions.prompt_text}
  Camera: ${cameraSummary(json.camera)}.
  Style: ${styleSummary(json.style)}.
  Render photorealistic, high detail.`;
    }
  
    const subject = json.subject && json.subject.type ? (json.subject.type === "person" ? "a person" : json.subject.type) : "a subject";
    const clothing = json.clothing && json.clothing.sku ? `wearing ${json.clothing.sku}` : "";
    const camera = cameraSummary(json.camera);
    const style = styleSummary(json.style);
  
    const base = `Studio portrait of ${subject} ${clothing}. ${style} ${camera}  Render photorealistic, high-detail skin and fabric textures.`;
    const negatives = (json.style && json.style.negative_prompts) ? json.style.negative_prompts.join(", ") : "";
    return negatives ? `${base} Negative: ${negatives}` : base;
  }
  
  module.exports = { assemblePrompt };
  