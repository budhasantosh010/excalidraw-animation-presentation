'use client'

import dynamic from 'next/dynamic'

import '../src/index.css'

const HostedAnimationStudio = dynamic(() => import('../src/App'), {
  ssr: false,
  loading: () => (
    <main className="cloud-loading" role="status">
      Loading Sanverse Animation Studio…
    </main>
  ),
})

export function AnimationStudio() {
  return <HostedAnimationStudio />
}
