import Link from "next/link"
import CreateBox from "./components/CreateBox"
import SideMenuDefault from "../components/SideMenuDefault"


export default function () { 
    return (
        <section className="w-screen h-screen bg-normal overflow-hidden flex flex-row">
            <div className="w-52 h-full">
                <SideMenuDefault />
            </div>
            <section className="w-10/12 h-full p-5 flex flex-col">
                <section className="w-full h-1/4">
                    <span className="text-header-2 text-white font-medium">Dashboard</span>
                </section>
                <section className="w-full h-1/3 flex flex-col gap-y-8 mb-11">
                    <p>My projects</p>
                    <div className="flex flex-row">
                        <CreateBox text={"create new project"} href={'/'}/>
                    </div>
                </section>
                <section className="w-full h-1/2 flex flex-col gap-y-8">
                    <p>My models</p>
                    <div className="flex flex-row">
                        <CreateBox text={"create new model"} href={'/createModel'}/>
                    </div>
                </section>
            </section>
        </section>
    )
}