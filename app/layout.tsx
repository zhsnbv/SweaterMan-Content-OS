import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';

export const metadata: Metadata = {
  title: 'Sweater Man Content OS',
  description: 'Внутренний инструмент планирования, производства и разбора контента Sweater Man.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppShell>{children}</AppShell>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              fontSize: '12px',
              borderRadius: '8px',
              border: '1px solid var(--color-line)',
            },
          }}
        />
      </body>
    </html>
  );
}
