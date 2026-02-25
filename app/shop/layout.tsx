import Link from 'next/link';
import { CartIcon } from '@/components/CartIcon';

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link href="/" className="font-bold text-xl text-indigo-600">
              Stripe CPM Demo
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/shop"
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
    </>
  );
}
