import Image from "next/image"

export default function PlusIcon ({size=14,}) { 
    return ( 
        <Image
        src={"/Add_Plus.svg"}
        alt="plus icon"
        width={size}
        height={size}
        />
    )
}