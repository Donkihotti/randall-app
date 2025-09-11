import Modal from "../Modal"
import SettingsForm from "../user/SettingsForm"

export default function SettingsModal ({ onClose, open }) { 
    return ( 
        <Modal open={open} onClose={onClose}>
         <div className="bg-normal rounded-md border border-light w-2xl h-2xl">
            
         </div>
        </Modal>
    )
}