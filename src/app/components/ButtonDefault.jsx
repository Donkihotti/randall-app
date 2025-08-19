
export default function ButtonDefault ({text, children, ...props }) { 
    return (
        <button 
        className="border border-neutral-100 bg-button drop-shadow-md text-neutral-500 rounded-xs px-6 py-1 hover:cursor-pointer hover:bg-neutral-200 transition-all duration-150"
        {...props}
        >
        { children || text }
        </button>
    )
}