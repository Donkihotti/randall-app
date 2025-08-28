'use client';

import { useState } from "react";

import StartModalNavigate from "../components/StartModalNavigate";
import CreateBox from "./components/CreateBox"
import FolderBox from "./components/FolderBox"
import PageLayout from "../components/PageLayout/PageLayout"
import DropDownButton from "../components/buttons/DropDownButton";

export default function Dashboard () { 
    const [showStartModal, setShowStartModal] = useState(false);
    return (
        <PageLayout>
            <section className="w-full h-full flex flex-col">
                <section className="w-full h-1/4">
                    <span className="text-header-2 text-white font-medium">Dashboard</span>
                </section>
                <div className="w-22 mb-10">
                    <DropDownButton text={"Create"}/>
                </div>
                <section className="w-full h-1/3 flex flex-row gap-y-8 mb-11">
                    <div className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                        <p>My projects</p>
                        <div className="flex flex-row gap-x-4">
                            <CreateBox text={"create new project"} href={'/'}/>
                            <FolderBox text={"All projects"} href={'/'}/>
                        </div>
                  </div>
                  <div className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                        <p>My Templates</p>
                        <div className="flex flex-row gap-x-4">
                            <CreateBox text={"create new template"} href={'/'}/>
                            <FolderBox text={"All templates"} href={'/'}/>
                        </div>
                  </div>    
                </section>
                <section className="w-full h-1/3 flex flex-row gap-y-8 mb-11">
                    <div className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                        <p>My models</p>
                        <div className="flex flex-row gap-x-4">
                            <CreateBox text={"create new model"} onClick={() => setShowStartModal(true)}/>
                            <FolderBox text={"All models"} href={'/'}/>
                        </div>
                  </div>
                  <div className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                        <p>My assets</p>
                        <div className="flex flex-row gap-x-4">
                            <CreateBox text={"create new asset"} href={'/'}/>
                            <FolderBox text={"All assets"} href={'/'}/>
                        </div>
                  </div>    
                </section>
            </section>
            <StartModalNavigate open={showStartModal} onClose={() => setShowStartModal(false)} />
        </PageLayout>
    )
}