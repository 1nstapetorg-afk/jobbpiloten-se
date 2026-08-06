'use client'

// components/UserMenu.jsx — Round-94 (professional polish): the SINGLE
// profile-picture element.
//
// The old navbars rendered TWO avatar elements side by side — the app's
// ProfileAvatar (upload / chosen avatar / default plane) AND Clerk's
// <UserButton /> (an unrelated Clerk-account avatar). This component
// replaces both: ONE 36px circular avatar (the app profile picture)
// wrapped in a dropdown with "Min profil" / "Inställningar" / "Logga
// ut". The Clerk UserButton is no longer mounted anywhere in the app —
// this menu IS the account surface.
//
// Behavior contract:
//   • Trigger is 36px circular with a subtle ring on hover.
//   • "Hej {förnamn}!" (optional `showName`) renders NEXT TO the avatar
//     inside the same trigger — one element, not two.
//   • Logout: Clerk `signOut({ redirectUrl: '/' })` when Clerk is
//     configured; otherwise the demo-mode logout (clear the
//     localStorage demo identity + force-demo flag + the demoUserId
//     cookie) then redirect to '/'.
//   • `data-testid` passthrough so e2e can target the trigger.

import { useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { User, Settings, LogOut } from 'lucide-react'
import ProfileAvatar from '@/components/ProfileAvatar'
import { isClerkConfiguredClient } from '@/lib/clerk-config'
import { DEMO_COOKIE_NAME } from '@/lib/auth-cookie'

const isClerkConfigured = isClerkConfiguredClient

export default function UserMenu({
  profile = null,
  user = null,
  showName = false,
  dataTestid = 'user-menu',
}) {
  const router = useRouter()

  // One display name source for both the trigger greeting and the menu
  // label — profile.fullName wins (the canonical app profile), then the
  // Clerk/demo user identity, then a neutral fallback.
  const fullName =
    (profile && profile.fullName) ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  const firstName = (fullName || '').split(' ')[0]

  const handleLogout = useCallback(async () => {
    // Clerk-configured: sign out through Clerk (clears the Clerk session
    // server-side + client-side). Dynamic import so a missing/broken
    // Clerk module can never white-screen the menu.
    if (isClerkConfigured()) {
      try {
        const mod = await import('@clerk/nextjs')
        if (typeof mod.signOut === 'function') {
          await mod.signOut({ redirectUrl: '/' })
          return
        }
      } catch (_) {
        // Clerk module failed — fall through to the demo logout so the
        // user is never stuck with a dead menu item.
      }
    }
    // Demo mode (or Clerk failure fallback): clear the local identity +
    // the server-side demo cookie, then land on '/'.
    try {
      localStorage.removeItem('demoUser')
      localStorage.removeItem('jobbpiloten_forceDemo')
    } catch (_) { /* storage unavailable — cookie clear still applies */ }
    document.cookie = `${DEMO_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
    router.push('/')
  }, [router])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={dataTestid}
          aria-label={firstName ? `Profilmeny för ${firstName}` : 'Profilmeny'}
          className="group inline-flex items-center gap-2 rounded-full outline-none transition-transform active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
        >
          {/* Single avatar — 36px circular, subtle ring appears on hover.
              The greeting text (optional) sits next to it in the same
              trigger so the header shows exactly ONE identity element. */}
          <span className="inline-flex rounded-full ring-2 ring-transparent transition-shadow duration-200 group-hover:ring-indigo-200 group-focus-visible:ring-indigo-200">
            <ProfileAvatar profile={profile} size={36} dataTestid="profile-avatar-nav" />
          </span>
          {showName && firstName && (
            <span className="hidden md:inline text-sm text-slate-600 transition-colors group-hover:text-slate-900">
              Hej {firstName}!
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-semibold truncate">
          {fullName || 'Mitt konto'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <User className="w-4 h-4" /> Min profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="w-4 h-4" /> Inställningar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => { void handleLogout() }}
          className="text-red-600 focus:text-red-700 focus:bg-red-50"
        >
          <LogOut className="w-4 h-4" /> Logga ut
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
