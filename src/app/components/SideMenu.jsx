'use client'

import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import Image from 'next/image'

import SettingsModal from './modals/SettingsModal'
import LogoutButton from './buttons/LogOutButton'

const firstGroupLinks = [
  { name: 'Dashboard', path: '/dashboard', icon: '/House_01.svg', alt: 'House icon, home-icon' },
  { name: 'Projects', path: '/', icon: '/Folders.svg', alt: 'folders-icon'  },
  { name: 'Models', path: '/models', icon: '/Users_Group.svg', alt: 'models icon' },
  { name: 'Assets', path: '/', icon: '/Drag_Horizontal.svg', alt: 'models icon' },
  { name: 'Templates', path: '/', icon: '/Layers.svg', alt: 'Templates icon' },
]

const secondGroupLinks = [
  { name: 'Account', path: '/dashboard', icon: '/User_02.svg', alt: 'user icon' },
  { name: 'Buy credits', path: '/', icon: '/Shopping_Bag_01.svg', alt: 'Shopping bag icon' },
]

const thirdGroupLinks = [
  { name: 'Guides', path: '/', icon: '/Notebook.svg', alt: 'Notebook icon' },
]

const fourthGroupLinks = [
  { name: 'Feedback', path: '/dashboard', icon: '/Paper_Plane.svg', alt: 'Paper plane icon'  },
  { name: 'Report a bug', path: '/', icon: '/Shield_Warning.svg', alt: 'warning icon, report a bug'  },
]

export default function SideMenu() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false); 

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

  useEffect(() => {
    let mounted = true
    async function loadProfile() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/profile/me', {
          method: 'GET',
          credentials: 'include', // IMPORTANT: send cookies
          headers: { 'Accept': 'application/json' },
        })

        if (res.status === 401) {
          // not signed in
          if (!mounted) return
          setProfile(null)
          setLoading(false)
          return
        }

        // check content-type so we don't crash on HTML
        const ct = res.headers.get('Content-Type') || ''
        if (!ct.includes('application/json')) {
          const text = await res.text()
          console.error('Unexpected /api/profile/me response:', text.slice(0, 1000))
          if (!mounted) return
          setError('Unexpected server response')
          setLoading(false)
          return
        }

        const data = await res.json()
        if (!mounted) return
        if (!res.ok) {
          setError(data?.error || 'Failed to load profile')
        } else {
          setProfile(data.profile || null)
        }
      } catch (err) {
        console.error('Failed to load profile', err)
        if (mounted) setError('Network error')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadProfile()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="w-62 h-screen bg-normal z-10 relative" ref={dropdownRef}>
    <div className='w-full px-3.5'>
      <button className={`flex flex-row pl-1 py-1 overflow-hidden border border-light w-full rounded-md items-center gap-x-3 hover:cursor-pointer hover:bg-light ${isOpen ? 'bg-light' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <div className="h-7 w-7 bg-default-orange rounded-xs flex items-center justify-center"><p className='text-2xl font-semibold'>#</p></div>
        <div className='flex flex-row gap-x-10 items-center'> 
          {loading ? (
            <div className="text-sm">Loading…</div>
          ) : profile ? (
            <div className="text-sm font-semibold">{profile.username || profile.display_name || 'User'}</div>
          ) : (
            <Link className="text-sm font-semibold" href="/login">Sign in</Link>
          )}
          <Image
          src={"/Unfold_More.svg"}
          alt='unfold more icon'
          width={18}
          height={18}
          className='mr-3.5'
          />
        </div>
      </button>
      </div>
      {isOpen && (
        <div className="absolute left-3.5 mt-1 w-3xs text-white bg-[#323232] border-[0.5px] border-light rounded-md z-10 p-2 drop-shadow-md">
            <div className='flex flex-col'>
            <div className='flex flex-row w-full gap-x-2'>
                <div className='w-10 h-10 bg-normal-dark rounded-xs'></div>
                <div className='flex flex-col'>
                    <p className='text-small font-semibold'>{profile.username}</p>
                    <p className='text-xs'>User plan</p>
                    </div>
            </div>
            </div>
            <div className='border rounded-xs border-light pl-2 pr-3.5 py-1 text-small w-fit flex flex-row gap-x-2 hover:cursor-pointer my-3.5' onClick={() => setShowSettingsModal(true)}>
                <Image 
                src={"/Settings.svg"}
                alt='Settings icon'
                width={14}
                height={14}
                />
                <span>Settings</span>
            </div>
            <hr className='text-light my-1'/>
            <div className='w-full hover:bg-light hover:cursor-pointer py-1 rounded-xs'>
            <LogoutButton redirectTo="/"/>
            </div>
        </div>
      )}

      <div className="mt-16 text-small text-white font-semibold flex flex-col w-full">
        <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] px-3.5 pb-3.5">
          {firstGroupLinks.map((item, i) => (
            <div className='flex flex-row gap-x-2 hover:bg-light rounded-xs px-2 py-1 w-full transition-colors duration-100 hover:cursor-pointer' key={i}>
             <Image 
             src={item.icon}
             alt={item.alt}
             width={17}
             height={17}
             />   
            <Link className="w-full" key={i} href={item.path}>
              {item.name}
            </Link>
            </div>
          ))}
        </div>

        <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] px-3.5 py-3.5">
          {secondGroupLinks.map((item, i) => (
              <div className='flex flex-row gap-x-2 hover:bg-light rounded-xs px-2 py-1 w-full transition-colors duration-100 hover:cursor-pointer' key={i}>
              <Image 
              src={item.icon}
              alt={item.alt}
              width={17}
              height={17}
              />   
             <Link className="w-full" key={i} href={item.path}>
               {item.name}
             </Link>
             </div>
          ))}
        </div>

        <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] px-3.5 py-3.5">
          {thirdGroupLinks.map((item, i) => (
            <div className='flex flex-row gap-x-2 hover:bg-light rounded-xs px-2 py-1 w-full transition-colors duration-100 hover:cursor-pointer' key={i}>
            <Image 
            src={item.icon}
            alt={item.alt}
            width={17}
            height={17}
            />   
           <Link className="w-full" key={i} href={item.path}>
             {item.name}
           </Link>
           </div>
          ))}
        </div>

        <div className="w-full gap-y-2 flex flex-col border-b border-[#545454] px-3.5 py-3.5">
          {fourthGroupLinks.map((item, i) => (
            <div className='flex flex-row gap-x-2 hover:bg-light rounded-xs px-2 py-1 w-full transition-colors duration-100 hover:cursor-pointer' key={i}>
            <Image 
            src={item.icon}
            alt={item.alt}
            width={17}
            height={17}
            />   
           <Link className="w-full" key={i} href={item.path}>
             {item.name}
           </Link>
           </div>
          ))}
        </div>
      </div>
    
    <div className='w-full px-3.5'>
      <Link href={'/settings'} className='flex flex-row gap-x-2 hover:bg-light rounded-xs px-2 py-1 w-full transition-colors duration-100 hover:cursor-pointer mt-8 text-small font-semibold'>
        <Image
        src={"/Settings.svg"}
        alt='settings-icon'
        width={17}
        height={17}
        />
        <p>Settings</p>
      </Link>
      </div>

      <div className="flex flex-col mx-3.5 bg-normal-dark mt-12 rounded-md hover:cursor-pointer border border-light absolute bottom-6">
        <div className='w-full h-22 relative'>
            <Image 
            src={"/discord-image.jpg"}
            alt='discord cover image'
            fill={true}
            className='object-cover rounded-md'
            />
        <div className='w-full h-full absolute bottom-0 bg-gradient-to-t from-normal-dark'></div>
        </div>
            <div className='flex flex-col p-3'>
                <p className="text-small font-semibold">Discord</p>
                <p className="text-xs mt-2">Join our discord channel to get useful tips from other users.</p>
            </div>
      </div>
      <SettingsModal open={showSettingsModal} onClose={() => setShowSettingsModal(false)}></SettingsModal>
    </div>
  )
}
