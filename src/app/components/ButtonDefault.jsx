
export default function ButtonDefault ({text, children, ...props }) { 
    return (
        <button 
        className="bg-button drop-shadow-md text-neutral-50 rounded-xs px-4 py-1 hover:cursor-pointer hover:bg-neutral-600 transition-all duration-150"
        {...props}
        >
        { children || text }
        </button>
    )
}