import Image from "next/image"

export default function ButtonOrange ({ children, text, ...props }) { 
    return ( 
        <button 
        className="bg-default-orange text-white rounded-xs px-6 py-1 hover:cursor-pointer hover:bg-orange-focus transition-all duration-150 flex flex-row items-center gap-x-2"
        {...props}
        type="button"
        >
        { children || text }
        <Image 
        src={"/arrow-long-right.svg"}
        alt="arrow long right"
        width={18}
        height={18}
        />
        </button>
    )
}