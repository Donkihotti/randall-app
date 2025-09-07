'use client';

import { useState } from "react";

import StartModalNavigate from "../components/StartModalNavigate";
import CreateBox from "./components/CreateBox"
import FolderBox from "./components/FolderBox"
import PageLayout from "../components/PageLayout/PageLayout"
import DropDownButton from "../components/buttons/DropDownButton";
import StartModalProject from "../components/StartModalProject";

export default function Dashboard () { 
    const [showStartModal, setShowStartModal] = useState(false);
    const [showProjectModal, setProjectModal] = useState(false); 
    return (
        <PageLayout>
            <section className="w-full h-full flex flex-col">
                    <span className="text-medium text-white font-medium">Dashboard</span>
                <div className="w-22 my-10">
                    <DropDownButton text={"Create"}/>
                </div>
                <section className="w-full h-2/3 border border-light p-small flex flex-col items-center justify-center rounded-xs relative">
                <div className="w-full h-8 bg-light absolute top-0"></div>
                <section className="w-full h-1/3 flex flex-row gap-y-8 mb-11">
                    <div className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                        <p>My projects</p>
                        <div className="flex flex-row gap-x-4">
                            <CreateBox text={"create new project"} onClick={() => setProjectModal(true)}/>
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
            </section>
            <StartModalNavigate open={showStartModal} onClose={() => setShowStartModal(false)} />
            <StartModalProject open={showProjectModal} onClose={() => setProjectModal(false)} />
        </PageLayout>
    )
}