import Image from "next/image"
import Link from "next/link"

export default function Logo () { 
    return (
        <Link href={"/"}>
            <Image 
            src={"/logo.svg"}
            alt="Randall Logo"
            width={92}
            height={32}
            />
        </Link>
    )
}