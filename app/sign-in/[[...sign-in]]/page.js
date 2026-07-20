'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plane } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { setDemoSessionCookie } from '@/lib/auth-cookie'
import { isClerkConfiguredClient as isClerkConfigured } from '@/lib/clerk-config'

export default function SignInPage() {
  const [useClerk, setUseClerk] = useState(false)
  const [SignInComponent, setSignInComponent] = useState(null)
  const [demoEmail, setDemoEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const configured = isClerkConfigured()
    setUseClerk(configured)

    if (configured) {
      // Dynamically import Clerk's SignIn to avoid crash if keys are invalid
      import('@clerk/nextjs').then(mod => {
        setSignInComponent(() => mod.SignIn)
      }).catch(() => {
        setUseClerk(false)
      })
    }
  }, [])

  const handleDemoSignIn = () => {
    setLoading(true)
    const email = demoEmail.trim() || 'demo@jobbpiloten.se'
    const demoUser = {
      id: 'demo-user-001',
      firstName: 'Demo',
      lastName: 'Användare',
      fullName: 'Demo Användare',
      primaryEmailAddress: { emailAddress: email },
      emailAddresses: [{ emailAddress: email, id: 'demo-email-1' }],
      imageUrl: null,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem('demoUser', JSON.stringify(demoUser))
    // 30-day cookie (helper applies `Secure` on https:, `SameSite=Lax`
    // everywhere). Centralised in `lib/auth-cookie.js` so the same
    // settings flow through the sign-in, onboarding, and
    // `DemoAuthProvider` bootstrap paths — drift in any of those
    // would silently break the "remember me" UX.
    setDemoSessionCookie(demoUser.id)
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex flex-col">
      <nav className="border-b border-slate-100 bg-white/60 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
              <Plane className="w-5 h-5 text-white -rotate-45" />
            </div>
            <span className="font-bold text-lg">JobbPiloten</span>
          </Link>
        </div>
      </nav>
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900">Välkommen tillbaka</h1>
            <p className="mt-2 text-slate-600">Logga in för att komma till din dashboard</p>
          </div>

          {useClerk && SignInComponent ? (
            <SignInComponent
              appearance={{
                elements: {
                  rootBox: 'mx-auto',
                  card: 'shadow-xl border border-slate-100',
                },
              }}
            />
          ) : (
            <Card className="shadow-xl border border-slate-100">
              <CardHeader>
                <CardTitle className="text-lg">Demo-inloggning</CardTitle>
                <CardDescription>
                  Clerk-nycklar saknas eller är ogiltiga. Logga in i demoläge för att testa applikationen.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="demo-email">E-postadress (valfritt)</Label>
                  <Input
                    id="demo-email"
                    type="email"
                    value={demoEmail}
                    onChange={e => setDemoEmail(e.target.value)}
                    placeholder="demo@jobbpiloten.se"
                    className="mt-1.5"
                  />
                </div>
                <Button
                  onClick={handleDemoSignIn}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-blue-600"
                >
                  {loading ? 'Loggar in…' : 'Logga in (demo-läge)'}
                </Button>
                <p className="text-xs text-slate-500 text-center">
                  Detta är ett demo-läge. Inga riktiga data används. För riktig autentisering, konfigurera Clerk-nycklar i .env.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}