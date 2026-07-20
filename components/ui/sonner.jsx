"use client";
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />
  );
}

// Re-export `toast` so app/providers.js can call toast.success(...)
// from the SAME module that mounts <Toaster />. Before this re-export
// the Round-12 TokenMintBridge build was broken because providers.js
// already destructured `toast` from here (no-op until a consumer
// called it) and webpack's tree-shaking caught the dangling name.
// With `toast` exported alongside `Toaster`, any caller does
// `import { Toaster, toast } from '@/components/ui/sonner'` and gets a
// stable, audited source for both pieces of the notification stack.
export { Toaster, toast }
