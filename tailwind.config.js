/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
      './pages/**/*.{js,jsx}',
      './components/**/*.{js,jsx}',
      './app/**/*.{js,jsx}',
      './src/**/*.{js,jsx}',
    ],
    prefix: "",
    theme: {
      container: {
        center: true,
        padding: '2rem',
        screens: {
          '2xl': '1400px'
        }
      },
      extend: {
        colors: {
          border: 'hsl(var(--border))',
          input: 'hsl(var(--input))',
          ring: 'hsl(var(--ring))',
          background: 'hsl(var(--background))',
          foreground: 'hsl(var(--foreground))',
          primary: {
            DEFAULT: 'hsl(var(--primary))',
            foreground: 'hsl(var(--primary-foreground))'
          },
          secondary: {
            DEFAULT: 'hsl(var(--secondary))',
            foreground: 'hsl(var(--secondary-foreground))'
          },
          destructive: {
            DEFAULT: 'hsl(var(--destructive))',
            foreground: 'hsl(var(--destructive-foreground))'
          },
          muted: {
            DEFAULT: 'hsl(var(--muted))',
            foreground: 'hsl(var(--muted-foreground))'
          },
          accent: {
            DEFAULT: 'hsl(var(--accent))',
            foreground: 'hsl(var(--accent-foreground))'
          },
          popover: {
            DEFAULT: 'hsl(var(--popover))',
            foreground: 'hsl(var(--popover-foreground))'
          },
          card: {
            DEFAULT: 'hsl(var(--card))',
            foreground: 'hsl(var(--card-foreground))'
          },
          chart: {
            '1': 'hsl(var(--chart-1))',
            '2': 'hsl(var(--chart-2))',
            '3': 'hsl(var(--chart-3))',
            '4': 'hsl(var(--chart-4))',
            '5': 'hsl(var(--chart-5))'
          },
          sidebar: {
            DEFAULT: 'hsl(var(--sidebar-background))',
            foreground: 'hsl(var(--sidebar-foreground))',
            primary: 'hsl(var(--sidebar-primary))',
            'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
            accent: 'hsl(var(--sidebar-accent))',
            'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
            border: 'hsl(var(--sidebar-border))',
            ring: 'hsl(var(--sidebar-ring))'
          }
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)'
        },
        keyframes: {
          'accordion-down': {
            from: {
              height: '0'
            },
            to: {
              height: 'var(--radix-accordion-content-height)'
            }
          },
          'accordion-up': {
            from: {
              height: 'var(--radix-accordion-content-height)'
            },
            to: {
              height: '0'
            }
          },
          // Hero background cycle — slow 15s ease-in-out shift of the
          // amber→indigo gradient's background-position so the hero
          // feels alive without ever distracting from the laptop
          // mockup. Long duration is intentional: it's a "breathing"
          // effect, not a call to action.
          'hero-bg-cycle': {
            '0%, 100%':   { 'background-position': '0% 50%' },
            '50%':         { 'background-position': '100% 50%' },
          },
          // Three particle drift variants. Different translatation
          // amplitudes + slightly offset speeds so the 3 dots never
          // travel in lock-step — feels like a small constellation
          // gently drifting rather than 3 marquees. The `src/drifts`
          // ringback is intentionally tight (~6–10px total amplitude)
          // so the particles stay inside their hero column on laptops.
          'hero-particle-a': {
            '0%, 100%': { transform: 'translate(0, 0)' },
            '33%':       { transform: 'translate(8px, -6px)' },
            '66%':       { transform: 'translate(-4px, 4px)' },
          },
          'hero-particle-b': {
            '0%, 100%': { transform: 'translate(0, 0)' },
            '50%':       { transform: 'translate(-7px, 5px)' },
          },
          'hero-particle-c': {
            '0%, 100%': { transform: 'translate(0, 0)' },
            '25%':       { transform: 'translate(-3px, -5px)' },
            '75%':       { transform: 'translate(6px, 3px)' },
          },
        },
        animation: {
          'accordion-down': 'accordion-down 0.2s ease-out',
          'accordion-up': 'accordion-up 0.2s ease-out',
          'hero-bg-cycle':  'hero-bg-cycle 15s ease-in-out infinite',
          'hero-particle-a': 'hero-particle-a 18s ease-in-out infinite',
          'hero-particle-b': 'hero-particle-b 22s ease-in-out infinite',
          'hero-particle-c': 'hero-particle-c 26s ease-in-out infinite',
        }
      }
    },
    plugins: [require("tailwindcss-animate")],
  }