import Link from 'next/link';

export default function SubscribeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link href="/" className="font-bold text-xl text-purple-600">
              Stripe CPM Demo
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/subscriptions"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                Plans
              </Link>
              <Link
                href="/"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                Back to Home
              </Link>
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
