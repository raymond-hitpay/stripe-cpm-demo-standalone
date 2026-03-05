import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

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
  const env = process.env.NEXT_PUBLIC_HITPAY_ENV || 'sandbox';
  const showBanner = env !== 'production';
  const displayEnv = env.charAt(0).toUpperCase() + env.slice(1);

  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        {showBanner && (
          <div className="bg-amber-400 text-amber-900 text-center py-2 px-4 text-sm font-medium">
            You are currently in &quot;{displayEnv}&quot; mode. No real payments will be made
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
