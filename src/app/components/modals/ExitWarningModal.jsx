import ButtonOrange from "../buttons/ButtonOrange";
import DefaultButton from "../buttons/DefaultButton";
import Modal from "../Modal";

export default function ExitWarningModal ({open, onclose}) { 
    return(
        <Modal open={open} onClose={onclose}>
            <div>
                <p>Are you sure you want to exit?</p>
                <p>Your model will be deleted if you exit</p>
                <DefaultButton text={'Yes exit model'}/>
                <ButtonOrange text={'Back to model'}></ButtonOrange>
            </div>
        </Modal>
    )
}