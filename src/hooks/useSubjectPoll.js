// src/hooks/useSubjectPoll.js
/**
 * useSubjectPoll
 *
 * Reusable hook for polling subject status.
 *
 * Usage:
 *   const { subject, mappedStatus, loading, error, refresh, stop } = useSubjectPoll(subjectId, {
 *     interval: 2000,
 *     onUpdate: (subject) => { ... },
 *     getStatusFn: async (id) => { ... } // optional custom fetcher
 *   });
 *
 * Notes:
 *  - mappedStatus is the client flow step returned by mapServerStatus(subject) or null
 *    (null means "don't change client state automatically").
 *  - The hook will not overwrite local state if mapServerStatus returns null.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { mapServerStatus } from "../lib/subjectStatus";

export default function useSubjectPoll(subjectId, opts = {}) {
  const {
    interval = 2000,
    onUpdate = () => {},
    getStatusFn = null,
    enabled = true,
  } = opts || {};

  const [subject, setSubject] = useState(null);
  const [mappedStatus, setMappedStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const timerRef = useRef(null);

  // default fetcher: calls /api/subject/:id/status and expects { subject }
  const defaultGetStatus = useCallback(async (id) => {
    const res = await fetch(`/api/subject/${encodeURIComponent(id)}/status`);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Status fetch failed ${res.status}: ${t}`);
    }
    const j = await res.json();
    return j?.subject ?? null;
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!subjectId) return null;
    setLoading(true);
    setError(null);
    try {
      const fn = getStatusFn || defaultGetStatus;
      const subj = await fn(subjectId);
      if (!mountedRef.current) return subj;
      setSubject(subj || null);

      // map server status -> client flow step (may return null to avoid change)
      const mapped = mapServerStatus(subj);
      if (mapped) {
        setMappedStatus(mapped);
      }
      onUpdate?.(subj);
      setLoading(false);
      return subj;
    } catch (err) {
      if (!mountedRef.current) return null;
      console.error("useSubjectPoll fetchStatus error:", err);
      setError(err);
      setLoading(false);
      return null;
    }
  }, [subjectId, getStatusFn, defaultGetStatus, onUpdate]);

  useEffect(() => {
    mountedRef.current = true;
    if (!subjectId || !enabled) return () => { mountedRef.current = false; };

    // initial fetch + interval
    fetchStatus();
    timerRef.current = setInterval(() => {
      fetchStatus();
    }, interval);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [subjectId, interval, enabled, fetchStatus]);

  function refresh() {
    return fetchStatus();
  }

  function stop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  return { subject, mappedStatus, loading, error, refresh, stop };
}
