import TokenIcon from "../icons/TokenIcon";
import PlusIcon from "../PlusIcon";

export default function UserCredits () { 
    return ( 
            <div className="absolute top-3.5 right-3.5 border border-lighter rounded-full pl-1 pr-3 py-1 flex flex-row gap-x-3 items-center justify-center hover:cursor-pointer hover:border-white">
            <div className="flex items-center justify-center border border-lighter rounded-full p-1.5">
                <PlusIcon />
            </div>
                <div className="flex flex-row items-center justify-center gap-x-1">
                <span className="text-small font-semibold text-white">78</span>
                <TokenIcon />
                </div>
            </div>
    )
}