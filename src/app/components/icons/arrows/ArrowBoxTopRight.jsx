import Image from "next/image";

export default function ArrowBoxTopRight () { 
    return ( 
        <div className="w-8 h-8 border rounded-xs border-black flex items-center justify-center">
            <Image 
            src={"/arrow-long-top-right.svg"}
            alt="arrow top right"
            width={15}
            height={15}
            />
        </div>
    )
}