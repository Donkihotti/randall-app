'use client';

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

import StartModalNavigate from "../components/modals/StartModalNavigate";
import CreateBox from "./components/CreateBox"
import FolderBox from "./components/FolderBox"
import PageLayout from "../components/PageLayout/PageLayout"
import DropDownButton from "../components/buttons/DropDownButton";
import StartModalProject from "../components/modals/StartModalProject";
import StartModalPhotoshoot from "../components/modals/StartModalPhotoshoot";
import UserCredits from "../components/user/UserCredits";
import ProjectsList from "../components/projects/ProjectsList";

export default function Dashboard () { 
    const [showStartModal, setShowStartModal] = useState(false);
    const [showProjectModal, setShowProjectModal] = useState(false); 
    const [showPhotoshootModal, setShowPhotoshootModal] = useState(false); 

    return (
        <PageLayout>
            <section className="w-full min-h-screen flex flex-col">
             <UserCredits />   
            <span className="text-lg md:text-xl text-white font-medium">Dashboard</span>

            <div className="w-fit my-6">
                <DropDownButton text="Create" />
            </div>

            <div className="w-full grid grid-cols-12 gap-x-3.5 items-start">
            {/* LEFT: main content (8/12) */}
            <section className="col-span-8 border border-light p-4 md:p-6 flex flex-col items-center rounded-md relative text-small">
                <div className="w-full h-8 bg-light absolute top-0 left-0 rounded-t-md flex items-center px-6" />

                {/* First Row - keep two equal columns with grid */}
                <section className="w-full grid grid-cols-2 gap-8 mt-12">
                <div className="flex flex-col gap-2">
                    <p className="font-semibold">Projects</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new project" onClick={() => setShowProjectModal(true)} />
                    <FolderBox text="All projects" href="/projects" />
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <p className="font-semibold">Photoshoots</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new photoshoot" onClick={() => setShowPhotoshootModal(true)} />
                    <FolderBox text="Photoshoots" href="/photoshoots" />
                    </div>
                </div>
                </section>

                {/* Second Row - same grid so widths stay identical to first row */}
                <section className="w-full grid grid-cols-2 gap-8 mt-8">
                <div className="flex flex-col gap-2">
                    <p className="font-semibold">Models</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new model" onClick={() => setShowStartModal(true)} />
                    <FolderBox text="All models" href="/models" />
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <p className="font-semibold">Assets</p>
                    <div className="flex flex-wrap gap-4">
                    <CreateBox text="new asset" href="/" />
                    <FolderBox text="All assets" href="/" />
                    </div>
                </div>
                </section>
            </section>

            {/* RIGHT: sidebar (4/12) */}
            <section className="col-span-4 box-bg-normal-plus h-full flex flex-col p-3.5 relative">
                <span className="mb-5 text-small font-semibold">Recent Projects</span>
                <Link href={'/'} className="button-normal absolute flex flex-row gap-x-2 top-3.5 right-3.5">
                <Image src={'/List_Unordered.svg'} alt="list icon" width={18} height={18} />
                View all
                </Link>
                <ProjectsList />
            </section>
            </div>
            </section>
            <StartModalNavigate open={showStartModal} onClose={() => setShowStartModal(false)} />
            <StartModalProject open={showProjectModal} onClose={() => setShowProjectModal(false)} />
            <StartModalPhotoshoot open={showPhotoshootModal} onClose={() => setShowPhotoshootModal(false)} />
        </PageLayout>
    )
}