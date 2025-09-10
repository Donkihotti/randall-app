'use-client';

import Image from "next/image";
import Logo from "../components/Logo";
import Link from "next/link";
import SignInForm from "../components/Auth/SignInForm";

export default function SignUpPage () { 
    return ( 
        <section className="w-screen h-screen flex justify-center items-center bg-[url(/bg.jpeg)] bg-center bg-cover">
            <section className="w-10/12 h-9/12 bg-white rounded-md p-small flex flex-row drop-shadow-2xl">
                <div className="h-full w-3/8 flex flex-col items-center relative pr-3.5">
                    <div className="absolute top-0 left-0">
                        <Logo />
                    </div>
                    <p className="text-header-2 text-black">Sign In</p>
                    <SignInForm redirectTo="/dashboard"/>
                    <div className="flex flex-row gap-x-1">
                        <p className="text-black text-small">Don't have an account?</p>
                        <Link href='/SignUpPage' className="text-small text-black hover:underline font-semibold">Sign Up</Link>
                    </div>
                </div>
                <div className="bg-neutral-500 w-5/8 h-full rounded-xs relative">
                    <Image 
                    src='/bg.jpeg'
                    alt="bg"
                    fill={true}
                    className="object-cover rounded-xs"
                    />
                </div>
            </section>
        </section>
    )
}