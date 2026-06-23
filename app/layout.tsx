import type { Metadata } from 'next';
import './globals.css';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import ClientLayout from '@/components/ClientLayout';

export const metadata: Metadata = {
  title: '가계부 Pro',
  description: 'Personal expense tracker',
};

const FOUC_SCRIPT = `(function(){
  var t=localStorage.getItem('theme')||'dark';
  document.documentElement.setAttribute('data-theme',t);
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
        <QueryProvider>
          <ToastProvider>
            <ClientLayout>{children}</ClientLayout>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
