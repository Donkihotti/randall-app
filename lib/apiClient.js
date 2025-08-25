
export async function createSubject(payload) {
    const r = await fetch("/api/subject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  }
  
  export async function getSubjectStatus(id) {
    const r = await fetch(`/api/subject/${id}/status`);
    return r.json();
  }
  
  export async function enqueueModelSheet(subjectId, body = {}) {
    const r = await fetch(`/api/subject/${subjectId}/generate-model-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  
  export async function approveSubject(subjectId) {
    const r = await fetch(`/api/subject/${subjectId}/approve`, { method: "POST" });
    return r.json();
  }
  
  export async function enqueueUpscale(subjectId, payload = {}) {
    const r = await fetch(`/api/subject/${subjectId}/upscale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  }
  