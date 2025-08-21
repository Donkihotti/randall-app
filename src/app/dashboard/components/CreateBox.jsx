import PlusIconGray from "@/app/components/PlusIconGray";
import Link from "next/link";

export default function CreateBox ({text, href}) { 
    return (
        <Link href={href}>
        <div className="rounded-lg bg-normal-dark w-3xs h-52 flex flex-col gap-y-5 items-center justify-center hover:cursor-pointer hover:border hover:border-[#545454]">
            <PlusIconGray className="w-14 h-14 relative mt-3"/>
            <p className="text-small text-light">{text}</p>
        </div>
        </Link>  
    )
}