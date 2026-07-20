'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plane } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { isClerkConfiguredClient as isClerkConfigured } from '@/lib/clerk-config'

export default function SignUpPage() {
  const [useClerk, setUseClerk] = useState(false)
  const [SignUpComponent, setSignUpComponent] = useState(null)
  const [demoEmail, setDemoEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const configured = isClerkConfigured()
    setUseClerk(configured)

    if (configured) {
      import('@clerk/nextjs').then(mod => {
        setSignUpComponent(() => mod.SignUp)
      }).catch(() => {
        setUseClerk(false)
      })
    }
  }, [])

  const handleDemoSignUp = () => {
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
    document.cookie = `demoUserId=${demoUser.id}; path=/; max-age=86400`
    router.push('/onboarding')
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
            <h1 className="text-3xl font-bold text-slate-900">Starta din 14-dagars provperiod</h1>
            <p className="mt-2 text-slate-600">Ingen bindningstid. Avsluta när som helst.</p>
          </div>

          {useClerk && SignUpComponent ? (
            <SignUpComponent
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
                <CardTitle className="text-lg">Demo-registrering</CardTitle>
                <CardDescription>
                  Clerk-nycklar saknas eller är ogiltiga. Skapa ett demo-konto för att testa applikationen.
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
                  onClick={handleDemoSignUp}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-blue-600"
                >
                  {loading ? 'Skapar…' : 'Starta demo-konto'}
                </Button>
                <p className="text-xs text-slate-500 text-center">
                  Detta är ett demo-läge. Inga riktiga data används. För riktig autentisering, konfigurera Clerk-nycklar i .env.
                </p>
                <div className="text-center text-sm">
                  <span className="text-slate-500">Har du redan ett konto? </span>
                  <Link href="/sign-in" className="text-indigo-600 hover:underline">Logga in</Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}