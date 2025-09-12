'use client';

import { useState } from "react";

import StartModalNavigate from "../components/StartModalNavigate";
import CreateBox from "./components/CreateBox"
import FolderBox from "./components/FolderBox"
import PageLayout from "../components/PageLayout/PageLayout"
import DropDownButton from "../components/buttons/DropDownButton";
import StartModalProject from "../components/StartModalProject";
import UserCredits from "../components/user/UserCredits";
import ProjectsList from "../components/projects/ProjectsList";

export default function Dashboard () { 
    const [showStartModal, setShowStartModal] = useState(false);
    const [showProjectModal, setProjectModal] = useState(false); 
    return (
        <PageLayout>
            <section className="w-full min-h-screen flex flex-col">
             <UserCredits />   
            <span className="text-lg md:text-xl text-white font-medium">Dashboard</span>

            <div className="w-fit my-6">
                <DropDownButton text="Create" />
            </div>

            <div className="w-full flex flex-row gap-x-3.5">
            <section className="w-4/6 border border-light p-4 md:p-6 flex flex-col items-center rounded-md relative text-small">
                <div className="w-full h-8 bg-light absolute top-0 left-0 rounded-t-md flex items-center px-6">
                
                </div>

                {/* First Row */}
                <section className="w-full flex flex-col md:flex-row gap-8 mt-12">
                <div className="flex-1 flex flex-col gap-2">
                    <p className="font-semibold">Projects</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new project" onClick={() => setProjectModal(true)} />
                    <FolderBox text="All projects" href="/" />
                    </div>
                </div>

                <div className="flex-1 flex flex-col gap-2">
                    <p className="font-semibold">Templates</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new template" href="/" />
                    <FolderBox text="All templates" href="/" />
                    </div>
                </div>
                </section>

                {/* Second Row */}
                <section className="w-full flex flex-col md:flex-row gap-8 mt-8">
                <div className="flex-1 flex flex-col gap-2">
                    <p className="font-semibold">Models</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new model" onClick={() => setShowStartModal(true)} />
                    <FolderBox text="All models" href="/models" />
                    </div>
                </div>

                <div className="flex-1 flex flex-col gap-2">
                    <p className="font-semibold">Assets</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new asset" href="/" />
                    <FolderBox text="All assets" href="/" />
                    </div>
                </div>
                </section>
            </section>
            <section className="box-bg-normal h-96  flex flex-col p-3.5 w-2/6">
                <span className="mb-5">Recent Projects</span>
                <ProjectsList />
                <div className="min-w-96 h-1/3 bg-normal-dark p-3.5 flex flex-row gap-x-3.5 rounded-xs">
                    <div className="w-48 h-full bg-normal rounded-xs"></div>
                    <p>Project name</p>

                </div>
            </section>
            </div>
            </section>
            <StartModalNavigate open={showStartModal} onClose={() => setShowStartModal(false)} />
            <StartModalProject open={showProjectModal} onClose={() => setProjectModal(false)} />
        </PageLayout>
    )
}