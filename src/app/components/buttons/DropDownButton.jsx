import { useState, useRef, useEffect } from "react";

export default function DropDownButton({ text }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex justify-center rounded-xs px-4 py-1 bg-default-orange text-small hover:cursor-pointer"
      >
        {text}
        <svg
          className="ml-2 -mr-1 h-5 w-5"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.939l3.71-3.71a.75.75 0 111.06 1.061l-4.24 4.243a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute px-1 right-0 mt-2 w-40 text-white origin-top-right bg-normal border-[0.5px] border-light rounded-md z-10">
          <div className="py-1">
            <a
              href="#"
              className="block px-4 py-2 text-sm rounded-xs hover:bg-light"
            >
              New model
            </a>
            <a
              href="#"
              className="block px-4 py-2 text-sm hover:bg-light"
            >
              Create new project
            </a>
          </div>
         
        </div>
      )}
    </div>
  );
}
