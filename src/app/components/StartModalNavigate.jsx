"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import Modal from "./Modal";
import ButtonOrange from "./buttons/ButtonOrange";

export default function StartModalNavigate({ open, onClose }) {
  const [name, setName] = useState("");
  const router = useRouter();

  function handleCreate(e) {
    e?.preventDefault?.();
    if (!name?.trim()) {
      // basic inline feedback: you may prefer showNotification
      alert("Please add a model name before continuing.");
      return;
    }
    // Navigate to create-model page with name prefilled via query param.
    // The create-model page should read searchParams and prefill fields.
    const urlName = encodeURIComponent(name.trim());
    onClose?.(); 
    router.push(`/createModel?name=${urlName}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Start a new model">
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
      <h2 className="text-medium font-semibold">Create a new model</h2>
        <h4 className="text-small text-lighter mt-3 leading-4">Models are consistent throughout generated pictures and <br/>
        can be used to wear different clothing or with items. </h4>
      <div className="mt-8">
        <label className="block text-sm font-medium mb-1 text-lighter">Model name</label>
        <div className="flex flex-row gap-x-3 items-center bg-normal-dark pr-1 rounded-xs">
        <input 
        className="input-default px-2 py-2 m-1 w-full bg-normal-dark rounded-xs h-full text-small" 
        maxLength={60}
        required
        value={name} 
        placeholder={`"My model"`}
        onChange={(e)=>setName(e.target.value)}/>
        <ButtonOrange 
        disabled={!name.trim()} 
        type="submit">
            Create
        </ButtonOrange>
        </div>
      </div>
      <div className="flex flex-row gap-x-2 mt-5">
            <Image 
            src={'/Question.svg'}
            width={16}
            height={16}
            alt="question icon"
            />
            <Link href={"/"} className="text-small text-lighter leading-4 hover:underline">Learn more about models and different usecases</Link>
        </div>
    </form>
    </Modal>
  );
}
