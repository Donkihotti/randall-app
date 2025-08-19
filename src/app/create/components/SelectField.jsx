
export default function SelectField ({label, options = [], ...props }) { 
    return (
        <div className="flex flex-col gap-1">
        {label && <label className="text-sm font-medium">{label}</label>}
        <select
          className="border border-black rounded-md px-2 py-1 hover:cursor-pointer"
          {...props}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
}