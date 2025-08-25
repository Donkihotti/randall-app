import Image from "next/image"

export default function CloseButtonCircle () { 
    return ( 
        <div className="rounded-full bg-normal-dark p-0.5 w-fit hover:cursor-pointer">
            <Image 
            src={'/close-icon-light.png'}
            alt="close icon, X"
            width={15}
            height={15}
            />
        </div>
    )
}