import CreateModelPage from "../components/CreateModelPage";
import SideMenuDefault from "../components/SideMenuDefault";

export default function CreateModel () { 
    return ( 
        <section className="w-screen h-full flex flex-row bg-normal">
            <div className="w-52 h-full">
                <SideMenuDefault />
            </div>
            <section className="w-10/12">
                <CreateModelPage />
            </section>
        </section>
    )
}