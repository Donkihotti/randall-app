"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import Modal from "./Modal"; // adjust import path if your Modal is located elsewhere
import ButtonOrange from "../buttons/ButtonOrange"; // adjust path as needed

/**
 * StartModalPhotoshoot
 *
 * Props:
 *  - open: boolean (modal open)
 *  - onClose: fn to call when modal should close
 *  - projectId: optional string — if provided, create photoshoot under this project
 *  - initialName, initialDescription: optional
 *
 * Behavior:
 *  - Only collects name (required) and description (optional).
 *  - Posts to:
 *      - /api/projects/{projectId}/photoshoots  (when projectId is present)
 *      - /api/photoshoots                        (otherwise)
 *    with credentials: "include" so server reads HttpOnly cookies.
 *  - On success navigates to `/photoshoot/{id}/dashboard` and calls onClose().
 *  - Lots of console.logs for debugging.
 */
export default function StartModalPhotoshoot({
  open,
  onClose,
  projectId = null,
  initialName = "",
  initialDescription = "",
}) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const router = useRouter();
  
    async function handleSubmit(e) {
      e.preventDefault();
      setLoading(true);
      setError(null);
      console.log("[StartModalPhotoshoot] create start", { name, description });
  
      try {
        if (!name.trim()) throw new Error("Name is required");
  
        const res = await fetch("/api/photoshoots", {
          method: "POST",
          credentials: "include", // important: send HttpOnly cookies
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
        });
  
        console.log("[StartModalPhotoshoot] response status:", res.status, res.statusText);
        const json = await res.json().catch(() => null);
        console.log("[StartModalPhotoshoot] response json:", json);
  
        if (!res.ok) {
          throw new Error(json?.error || `Create failed (${res.status})`);
        }
  
        const photoshoot = json?.photoshoot;
        if (!photoshoot?.id) throw new Error("Invalid server response");
  
        console.log("[StartModalPhotoshoot] created photoshoot", photoshoot.id);
        // navigate to photoshoot dashboard
        router.push(`/photoshoot/${photoshoot.id}/studio`);
      } catch (err) {
        console.error("[StartModalPhotoshoot] create error", err);
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    }
  
    if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={projectId ? "Create photoshoot in project" : "Create a photoshoot"}>
      <form onSubmit={handleSubmit} className="w-xl mx-auto p-4 bg-normal rounded-md drop-shadow-xl relative border-[0.5px] border-light">
        <div className="absolute top-4 right-4">
          <button type="button" onClick={onClose} className="p-0.5 bg-normal hover:bg-normal-dark rounded-full hover:cursor-pointer">
            <Image src={"/Close_round_light.svg"} alt="close icon, X" width={16} height={16} />
          </button>
        </div>

        <h2 className="text-medium font-semibold">{projectId ? "Start a photoshoot in project" : "Start a new photoshoot"}</h2>
        <h4 className="text-small text-lighter mt-3 leading-4">
          Give this photoshoot a name to get started. You can add prompts, references and more in the next step.
        </h4>

        <div className="mt-8">
          <label className="block text-sm font-medium mb-2 text-lighter">Photoshoot name</label>
          <div className="flex flex-row gap-x-3 items-center bg-normal-dark pr-1 rounded-xs border border-light">
            <input
              className="input-default px-2 py-2 m-1 w-full bg-normal-dark rounded-xs h-full text-small"
              maxLength={120}
              required
              value={name}
              placeholder={`"Spring campaign #1"`}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>

          <label className="block text-small font-medium text-lighter mb-2 mt-5">Photoshoot description (optional)</label>
          <textarea
            className="textarea-default bg-normal-dark w-full h-28 rounded-xs text-small"
            placeholder="Short notes about the photoshoot (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
          />

          <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-x-2 mt-5 h-full items-center">
              <Image src={'/Question.svg'} width={16} height={16} alt="question icon" />
              <Link href={"/"} className="text-small text-lighter leading-4 hover:underline">Learn more about photoshoots</Link>
            </div>

            <ButtonOrange disabled={!name.trim() || loading} type="submit">
              {loading ? "Creating…" : "Create"}
            </ButtonOrange>
          </div>
        </div>

        {error && <div className="text-red-600 text-sm mt-3">{error}</div>}
      </form>
    </Modal>
  );
}
