'use client';

import ButtonOrange from "@/app/components/buttons/ButtonOrange";

export default function ProjectButtonRow ( ) { 
    return ( 
        <div className="flex flex-row w-full gap-x-2 h-8">
            <ButtonOrange text={"Create Photoshoot"}/>
        </div>
    )
}