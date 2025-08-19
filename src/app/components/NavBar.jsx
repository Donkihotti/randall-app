import Logo from "./Logo";
import Link from "next/link";

export default function NavBar () { 
    return ( 
        <div className="flex flex-row w-screen justify-between bg-white fixed top-0 left-0 px-5 py-2">
            <Logo />
            <div className="flex flex-row text-black">
                <Link href={"/create"}>Create</Link>
                <Link href={"/createImage"}>Create 2</Link>
            </div>
        </div>
    )
}