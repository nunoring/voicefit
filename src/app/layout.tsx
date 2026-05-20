import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import StepIndicator from '@/components/StepIndicator'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'VoiceFit — 내 말투로 쓰는 블로그',
  description: '내 말투를 학습해서 블로그 글을 자동 생성하는 AI 도구',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geist.variable} h-full bg-white antialiased`}>
      <body className="flex min-h-full flex-col bg-white text-gray-900">
        <header className="border-b border-gray-100 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <div className="flex items-center justify-between">
              <a href="/dashboard" className="text-lg font-bold tracking-tight text-blue-600">VoiceFit</a>
              <StepIndicator />
            </div>
          </div>
        </header>
        <main className="flex-1 bg-white">{children}</main>
      </body>
    </html>
  )
}
