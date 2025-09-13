import Modal from "./Modal"
import SettingsForm from "../user/SettingsForm"
import CloseButtonCircle from "../buttons/CloseButtonCircle"
import { useState } from "react"

export default function SettingsModal ({ onClose, open }) { 
    const [tab, setTab] = useState('account')
    return ( 
        <Modal open={open} onClose={onClose}>
         <div className="bg-normal-plus rounded-md border border-normal w-3xl h-2xl pl-8 pr-16 py-7 flex flex-col drop-shadow-xl relative">
            <div className="absolute top-3.5 right-3.5">
                <CloseButtonCircle />
            </div>
            <div className="flex flex-row text-small font-semibold gap-x-8 w-full border-b border-light">
                <button  role="tab"
                aria-selected={tab === "account"}
                onClick={() => setTab("account")}
                className={`pb-2 mb-0 text-small font-semibold focus:outline-none hover:cursor-pointer ${
                tab === "account" ? "border-b-2 border-primary" : "text-lighter"
                }`}>
                Account
                </button>
                <button
                role="tab"
                aria-selected={tab === "billing"}
                onClick={() => setTab("billing")}
                className={`pb-2 mb-0 text-small font-semibold focus:outline-none hover:cursor-pointer ${
                tab === "billing" ? "border-b-2 border-primary" : "text-lighter"
                }`}
                >
                Billing
                </button>
            </div>
            { tab === "account" ? (
                 <div className="flex flex-col mt-7">
                 <div className="flex flex-col w-full ">
                   <p className="text-small font-semibold">Account</p>
                   <label className="text-lighter mt-3.5 text-small">Username</label>
                   <input className="input-default bg-normal px-2 py-1 mt-1 mb-3.5 border border-light rounded-xs w-1/3"></input>
                 </div>
                 <div className="flex flex-col w-full mt-7">
                     <p className="text-small font-semibold">Account security</p>
                     <hr className="text-light mt-2"/>
                     
                     <div className="flex flex-row w-full justify-between mt-7">
                         <div className="flex flex-col">
                             <span className="text-small">Email</span>
                             <span className="text-small text-lighter">user@email.com</span>
                         </div>
                         <button className="button-normal-h-light">Change email</button>
                     </div>
                     <div className="flex flex-row w-full justify-between mt-3.5">
                         <div className="flex flex-col">
                             <span className="text-small">Password</span>
                             <span className="text-small text-lighter">Change your password</span>
                         </div>
                         <button className="button-normal-h-light">Change password</button>
                     </div>
                 </div>
             </div> 
            ) : (
                <div className="flex flex-col gap-7">
                <div>
                  <p className="text-small font-semibold mt-7">Billing</p>
                  <p className="text-small text-lighter mt-2">Manage payment methods, invoices and subscription.</p>
                </div>
  
                <div className="flex flex-col mt-4 gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-small font-semibold">Payment method</p>
                      <p className="text-small text-lighter">Visa ending in 1234</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="button-normal-h-light">Change</button>
                      <button className="button-normal-h-light">Remove</button>
                    </div>
                  </div>
  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-small font-semibold">Subscription</p>
                      <p className="text-small text-lighter">Pro — billed monthly</p>
                    </div>
                    <div>
                      <button className="button-normal-h-light">Manage</button>
                    </div>
                  </div>  
                  </div>
                </div>
            )}
         </div>
        </Modal>
    )
}