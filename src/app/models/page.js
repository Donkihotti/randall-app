'use client'; 

import { useEffect, useState } from "react";
import PageLayout from "../components/PageLayout/PageLayout";
import Image from "next/image";

export default function ModelsPage () { 
const [ subjects, setSubjects ] = useState([]); 

    useEffect(() => { 
        async function fetchSubjects() { 
            const res = await fetch("/api/subject");
            const result = await res.json();  
            if (res.ok) {
                setSubjects(result.subjects);
            } else {
                console.error(result.error)
            }
        } 
        fetchSubjects()
    }, []); 

    return ( 
        <PageLayout>
           <h1 className="text-medium">Models</h1> 
           <div className="flex flex-row flex-wrap gap-x-3.5 mt-8">
            {subjects.map((s, i)=> (
                <div className="text-white bg-normal w-1/3 mb-3.5 h-36 rounded-xs p-small flex flex-row border border-light hover:cursor-pointer" key={i}>
                    <Image
                    src={s.face_refs}
                    alt={s.name}
                    width={120}
                    height={120}
                    
                    />
                    <div className="flex flex-col">
                        <p key={s.id + 1}>{s.name}</p>
                        <p>{s.created_at}</p>
                    </div>
                </div>
            ))}
        </div>
        </PageLayout>
    )
}