'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { label: '내 글', href: '/dashboard' },
  { label: '말투 분석', href: '/onboarding' },
  { label: '글 생성', href: '/generate' },
]

export default function StepIndicator() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1">
      {NAV.map(({ label, href }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
