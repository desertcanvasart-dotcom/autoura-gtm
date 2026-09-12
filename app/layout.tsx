import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Autoura Growth',
  description: 'Autoura GTM concierge — qualify operators and book demos.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased text-slate-900">{children}</body>
    </html>
  )
}
