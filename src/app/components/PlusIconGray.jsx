import Image from "next/image";

export default function PlusIconGray ({className=""}) { 
    return (
        <div className={`relative ${className}`}>
            <Image
            src={"/plus-icon-gray.svg"}
            alt="plus icon gray"
            fill={true}
            className="object-cover"
            />
        </div>
    )
}