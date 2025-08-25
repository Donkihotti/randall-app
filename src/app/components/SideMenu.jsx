
import Link from "next/link"
import UserName from "./UserName"

const firstGroupLinks = [
    { name: 'Dashboard', path: '/dashboard', icon: ''},
    { name: 'Projects', path: '/', icon: ''},
    { name: 'Models', path: '/', icon: ''},
    { name: 'Assets', path: '/', icon: ''},
    { name: 'Templates', path: '/', icon: ''},
]

const secondGroupLinks = [
    { name: 'Account', path: '/dashboard', icon: ''},
    { name: 'Buy credits', path: '/', icon: ''},
]

const thirdGroupLinks = [
    { name: 'Resources', path: '/resources', icon: ''},
    { name: 'Guides', path: '/', icon: ''},
]

const fourthGroupLinks = [
    { name: 'Feedback', path: '/dashboard', icon: ''},
    { name: 'Report a bug', path: '/', icon: ''},
]

export default function SideMenu () { 
    return ( 
        <div className="w-56 h-screen bg-normal z-10">
            <div className="flex flex-col pl-6 py-2 bg-normal-dark rounded-md ml-3.5">
                <UserName className="text-small text-white"/>
                <Link className="text-[#545454]" href={'/'}>Manage Account</Link>
            </div>
            <div className="mt-16 text-small font-semibold flex flex-col w-full">
                <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] pl-6 pb-6">
                    {firstGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {secondGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {thirdGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
                <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] pl-6 py-6">
                    {fourthGroupLinks.map((item, i) => (
                        <Link key={i} href={item.path}>{item.name}</Link>
                    ))}
                </div>
            </div>
        </div>
    )
}