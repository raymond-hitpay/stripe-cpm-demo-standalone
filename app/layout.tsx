import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { CartIcon } from '@/components/CartIcon';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Stripe CPM Demo - Standalone',
  description: 'Demo showcasing Stripe Custom Payment Methods with HitPay PayNow (Standalone Integration)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <Link href="/" className="font-bold text-xl text-indigo-600">
                TechStore
              </Link>
              <div className="flex items-center gap-6">
                <Link
                  href="/"
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Products
                </Link>
                <CartIcon />
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
