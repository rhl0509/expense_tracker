import type { Metadata, Viewport } from 'next';
import './globals.css';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import ClientLayout from '@/components/ClientLayout';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import { THEME_COLORS } from '@/lib/theme';

export const metadata: Metadata = {
  title: '가계부 Pro',
  description: 'Personal expense tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '가계부',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

// themeColor는 여기서 내보내지 않는다. media 속성이 붙은 메타는 OS 설정만 보므로,
// 앱에서 고른 테마를 반영하려면 아래 스크립트/토글이 메타 하나를 직접 관리해야 한다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// 저장된 선택이 있으면 그걸 쓰고, 없으면 기기(OS) 설정을 따른다.
// 확정한 테마를 data-theme와 theme-color 메타 양쪽에 반영한다(테마 결정은 여기 한 곳).
const FOUC_SCRIPT = `(function(){
  var c=${JSON.stringify(THEME_COLORS)};
  var s=localStorage.getItem('theme');
  var t=s||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  document.documentElement.setAttribute('data-theme',t);
  var m=document.createElement('meta');
  m.setAttribute('name','theme-color');
  m.setAttribute('content',c[t]);
  document.head.appendChild(m);
  document.documentElement.classList.add('theme-ready');
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <QueryProvider>
          <ToastProvider>
            <ClientLayout>{children}</ClientLayout>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
