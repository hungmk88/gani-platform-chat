import '@fontsource-variable/inter';
import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Gani Platform' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-bg font-sans text-14 text-text">{children}</body>
    </html>
  );
}
