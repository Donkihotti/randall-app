'use client';

import React from "react";

export default function DefaultButton ({ children, text, type="button", ...props }) { 
    return ( 
        <button 
        type="type"
        onClick={rest.onClick}
        className={"bg-normal text-white rounded-xs px-6 py-1 transition-all duration-150 flex items-center"}>
            {children || text}
        </button>
    );
}