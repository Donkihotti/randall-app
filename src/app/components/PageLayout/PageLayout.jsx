import SideMenu from "../SideMenu";

export default function PageLayout ({ children }) {
    return ( 
        <section className="w-screen h-screen overflow-hidden fixed top-0 left-0 bg-normal pt-3.5 flex flex-row">
            <SideMenu />
            <div className="bg-normal-dark w-full h-full rounded-tl-md px-page pt-page relative">
                {children}
            </div>
        </section>
    )
}