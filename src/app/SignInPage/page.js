'use-client';

import Image from "next/image";
import Logo from "../components/Logo";
import Link from "next/link";
import SignInForm from "../components/Auth/SignInForm";

export default function SignUpPage () { 
    return ( 
        <section className="w-screen h-screen flex justify-center items-center bg-neutral-950 p-3.5 fixed">
                <div className="h-full w-3/8 flex flex-col items-center justify-center relative pr-3.5">
                    <div className="absolute top-0 left-0">
                        <Logo />
                    </div>
                    <div className="w-2/3 flex flex-col items-start">
                        <p className="text-3xl text-white">Welcome back! <br/> Sign in to start creating.</p>
                    </div>
                    <SignInForm redirectTo="/dashboard"/>
                    <div className="flex flex-row gap-x-1">
                        <p className="text-white text-small">Don't have an account?</p>
                        <Link href='/SignUpPage' className="text-small text-white hover:underline font-semibold">Sign Up</Link>
                    </div>
                </div>
                <div className="bg-neutral-500 w-5/8 h-full rounded-md relative">
                    <Image 
                    src='/bg.jpeg'
                    alt="bg"
                    fill={true}
                    className="object-cover rounded-md"
                    />
                </div>
        </section>
    )
}