/* eslint-disable react/only-export-components -- Next.js layout files export metadata alongside the component. */
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'

const title = 'Sanverse Animated Excalidraw'
const description =
  'Draw, sequence, and present animated Excalidraw scenes in your browser.'

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https'
  const metadataBase = host ? new URL(`${protocol}://${host}`) : undefined

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: '/favicon.svg',
      shortcut: '/favicon.svg',
    },
    openGraph: {
      title,
      description,
      type: 'website',
      images: metadataBase ? [new URL('/og.png', metadataBase).href] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: metadataBase ? [new URL('/og.png', metadataBase).href] : undefined,
    },
  }
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
