import NavBar from "../components/NavBar"

export default function Pricing () { 
    return (
    <section className="w-screen h-screen flex flex-col">
        <NavBar />
        <div className="flex flex-col items-center justify-center w-full h-1/3 mt-14">
            <h1 className="text-header text-black font-instrument">Pricing</h1>
        </div>
        <div className="w-full h-2/3 flex items-center justify-center">
            <div className="flex flex-col border border-light w-1/5 h-2/3 rounded-xs"></div>
        </div>
    </section>
    )
}