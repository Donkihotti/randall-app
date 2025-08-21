import Link from "next/link"

export default function SideMenuLink ({text, href=""}) { 
    return ( 
        <div className="border-b border-neutral-700 px-3 py-2 w-full h-12">
            <Link className="text-white text-sidemenu hover:bg-button h-full" href={href}>{text}</Link>
        </div>
    )
}