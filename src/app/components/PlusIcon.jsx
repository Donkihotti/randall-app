import Image from "next/image"

export default function PlusIcon () { 
    return ( 
        <Image
        src={"/plus-icon.svg"}
        alt="plus icon"
        width={14}
        height={14}
        />
    )
}