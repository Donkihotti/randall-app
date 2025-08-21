import AddMenu from "./AddMenu"
import SideMenuLink from "./SideMenuLink"

export default function SideMenu () { 
    return (
        <div className="h-screen fixed flex flex-col top-0 bg-menu left-0 w-52 z-10 border-r border-neutral-700 py-2">
            <SideMenuLink href={"/dashboard"} text={"Exit workspace"}/>
            <AddMenu />
        </div>
    )
}