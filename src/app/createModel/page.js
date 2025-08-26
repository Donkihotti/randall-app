"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import PageLayout from "../components/PageLayout/PageLayout";
import CreateModelFlow from "../components/CreateModelFlow";

export default function CreateModel () { 
const search = useSearchParams();
const name = search?.get("name") || "";

useEffect(() => {
    // nothing needed here if CreateModelFlow reads searchParams internally
  }, []);

    return ( 
        <PageLayout>
                <CreateModelFlow initialName={name}/>
        </PageLayout>
    )
}