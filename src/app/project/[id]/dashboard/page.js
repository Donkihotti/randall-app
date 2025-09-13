import ButtonOrange from "@/app/components/buttons/ButtonOrange";
import PageLayout from "@/app/components/PageLayout/PageLayout";
import Link from "next/link";
import ProjectButtonRow from "./components/ProjectButtonsRow";

const navLinks = [
    { name: 'Dashboard', path: '/dashboard'},
    { name: '/Projects', path: '/projects'},
    { name: '/Project', path: '/project/'},
  ]

export default function Page () { 
    return ( 
        <PageLayout>
            {navLinks.map((nav, i ) => ( 
            <Link href={nav.path} key={i} className="text-app-nav mb-4">{nav.name}</Link>
            ))}
            <ProjectButtonRow />
            <section className="w-full h-3/5 flex flex-row mt-16">
                <div className="box-bg-normal flex flex-row w-3/5 h-full p-3.5 relative">
                    <p className="text-small font-semibold">Photoshoots</p>
                    <button className="button-normal-h-light absolute top-3.5 right-3.5">View all</button>
                </div>
                <div className="flex flex-col w-2/5 h-full"></div>
            </section>
        </PageLayout> 
    )
}