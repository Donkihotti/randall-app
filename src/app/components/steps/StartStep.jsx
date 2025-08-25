"use client";

import Link from "next/link";
import { useState } from "react";
import ButtonOrange from "../buttons/ButtonOrange";
import Image from "next/image";
import CloseButtonCircle from "../buttons/CloseButtonCircle";

export default function StartStep({ onNext }) {
  const [name, setName] = useState("");

  return (
    <section className="w-full h-full flex items-center justify-center">
        <div className="w-xl mx-auto p-3.5 bg-normal rounded-md shadow relative">
        <div className="absolute top-3.5 right-3.5">
        <CloseButtonCircle /> 
        </div>   
      <h2 className="text-medium font-semibold">Name your model and create.</h2>
        <h4 className="text-small text-lighter mt-3.5 leading-4">Models are consistent throughout generated pictures and <br/>
        can be used to wear different clothing or with items. </h4>
        <div className="flex flex-row gap-x-2 mt-5">
            <Image 
            src={'/Question.svg'}
            width={18}
            height={18}
            alt="question icon"
            />
            <Link href={"/"} className="text-small text-lighter leading-4 hover:underline">Learn more about models</Link>
        </div>
      <div className="mt-8">
        <label className="block text-sm font-medium mb-2">Model name</label>
        <div className="flex flex-row gap-x-2 items-center bg-normal-dark pr-1 rounded-xs">
        <input 
        className="px-2 py-2 m-1 w-full bg-normal-dark rounded-xs h-full text-small" 
        maxLength={60}
        required
        value={name} 
        placeholder={`"My model"`}
        onChange={(e)=>setName(e.target.value)}/>
        <ButtonOrange 
        disabled={!name } 
        onClick={()=>onNext({ name })}>
            Create
        </ButtonOrange>
        </div>
      </div>
    </div>
    </section>
  );
}
