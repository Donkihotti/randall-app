import ArrowBoxTopRight from "./icons/arrows/ArrowBoxTopRight";
import Logo from "./Logo";
import Link from "next/link";

const links = [
    { name: 'Pricing', path: '/pricing'},
    { name: 'Docs', path: '/'},
    { name: 'Contact us', path: ''},
    { name: 'About us', path: ''},
    { name: 'How it works', path: ''},
]

export default function NavBar () { 
    return ( 
        <div className="flex flex-row w-screen justify-between bg-white fixed top-0 left-0 px-2 py-2 z-20">
            <Logo />
            <div className="flex flex-row gap-x-14">
                <div className="flex flex-row gap-x-6 items-center">
                    {links.map((item, i) => (
                        <Link key={i} href={item.path} className="text-small text-black hover:underline transition-all duration-200">{item.name}</Link>
                    ))}
                </div>
                <div className="flex flex-row gap-x-1 text-black">
                <Link href={'/SignInPage'} className="border rounded-xs flex items-center text-small leading-none px-3">sign in</Link>
                <ArrowBoxTopRight />
                </div>
            </div>
        </div>
    )
}