import Logo from "./Logo"
import Link from "next/link"

const firstGroupLinks = [
    { name: 'Dashboard', path: '/dashboard', icon: ''},
    { name: 'Projects', path: '/', icon: ''},
    { name: 'Models', path: '/', icon: ''}
]

const secondGroupLinks = [
    { name: 'Account', path: '/dashboard', icon: ''},
    { name: 'Buy credits', path: '/', icon: ''},
]

const thirdGroupLinks = [
    { name: 'Resources', path: '/dashboard', icon: ''},
    { name: 'Guides', path: '/', icon: ''},
]

const fourthGroupLinks = [
    { name: 'Feedback', path: '/dashboard', icon: ''},
    { name: 'Report a bug', path: '/', icon: ''},
]

export default function SideMenuDefault () { 
    return ( 
        <div className="w-52 h-screen absolute top-0 left-0 bg-side-menu border-r border-[#545454] z-10">
            <Logo />
            <div className="mt-16 text-small font-semibold">
                <div className="w-full gap-y-3 flex flex-col border-b border-[#545454] pl-6 pb-6">
                    {firstGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-3 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {secondGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-3 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {thirdGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-3 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {fourthGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
            </div>
        </div>
    )
}