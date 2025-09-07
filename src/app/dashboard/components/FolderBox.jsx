import Link from "next/link";

export default function FolderBox ({text, href}) { 
    return (
        <Link href={href}>
        <div className="rounded-lg bg-normal w-52 h-42 flex flex-col gap-y-5 items-center justify-center border border-light hover:cursor-pointer hover:border hover:border-[#545454]">
            <p className="text-small text-[#7D7D7D]">{text}</p>
        </div>
        </Link>  
    )
}