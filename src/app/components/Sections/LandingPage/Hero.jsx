'use client';

import NavBar from "../../NavBar";
import Image from "next/image";
import Link from "next/link";
import ArrowBoxTopRight from "../../icons/arrows/ArrowBoxTopRight";

export default function Hero () { 
    return ( 
        <section className="w-screen h-screen bg-white">
            <NavBar />
            <div className="w-full h-full mt-12 items-center flex">
                <div className="flex flex-row text-black items-center gap-x-5 w-1/2 h-1/3 pl-28 pb-28">
                    <div className="w-3xs h-96 relative">
                        <Image 
                        src={'/bull-landing.png'}
                        alt="pixelated bull"
                        fill={true}
                        className="object-cover"
                        />
                    </div>
                    <div className="flex flex-col gap-y-3.5">
                        <h1 className="font-instrument text-header leading-14">Introducing the new <br/> standard for creating <br/> visual assets with AI.</h1>
                        <h2 className="text-medium leading-7">Generate high-resolution visuals tuned to your brand kit. <br/> consistent, editable, and ready for campaigns.</h2>
                        <div className="flex flex-row gap-x-1">
                            <Link href={"/signUpPage"} className="box-link">Start Creating</Link>
                            <ArrowBoxTopRight/>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}