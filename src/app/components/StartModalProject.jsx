"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import Modal from "./Modal";
import ButtonOrange from "./buttons/ButtonOrange";

export default function StartModalProject ({ open, onClose }) {
  const [name, setName] = useState("");
  const router = useRouter();

  function handleCreate(e) {
    e?.preventDefault?.();
    if (!name?.trim()) {
      // basic inline feedback: you may prefer showNotification
      alert("Please add a project name before continuing.");
      return;
    }
    // Navigate to create-model page with name prefilled via query param.
    // The create-model page should read searchParams and prefill fields.
    const urlName = encodeURIComponent(name.trim());
    onClose?.(); 
    router.push(`/createModel?name=${urlName}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Start a new project">
    <form className="w-xl mx-auto p-4 bg-normal rounded-md shadow relative border-[0.5px] border-light" onSubmit={handleCreate}>
        <div className="absolute top-4 right-4">
            <button onClick={onClose} className="p-0.5 bg-normal hover:bg-normal-dark rounded-full hover:cursor-pointer">
                <Image 
                src={"/Close_round_light.svg"}
                alt="close icon, X"
                width={16}
                height={16}
                />
            </button>
        </div>   
      <h2 className="text-medium font-semibold">Create a new project</h2>
        <h4 className="text-small text-lighter mt-3 leading-4">Projects can be used to create multiple sets of pictures
        for multiple different usecases. For example it can be used to create pictures of a new product collection. </h4>
      <div className="mt-8">
        <label className="block text-sm font-medium mb-2 text-lighter">Project name</label>
        <div className="flex flex-row gap-x-3 items-center bg-normal-dark pr-1 rounded-xs">
        <input 
        className="input-default px-2 py-2 m-1 w-full bg-normal-dark rounded-xs h-full text-small" 
        maxLength={60}
        required
        value={name} 
        placeholder={`"My project"`}
        onChange={(e)=>setName(e.target.value)}/>
        </div>
        <label className="block text-sm font-medium text-lighter mb-2 mt-5">Project description (optional)</label>
        <textarea 
        className="textarea-default bg-normal-dark w-full h-28 rounded-xs text-small"
        placeholder="Describe your project "
        />
        <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-x-2 mt-5 h-full">
                <Image 
                src={'/Question.svg'}
                width={16}
                height={16}
                alt="question icon"
                />
                <Link href={"/"} className="text-small text-lighter leading-4 hover:underline">Learn more about projects and different usecases</Link>
            </div>
            <ButtonOrange 
            disabled={!name.trim()} 
            type="submit">
                Create
            </ButtonOrange>
        </div>
      </div>
    </form>
    </Modal>
  );
}
