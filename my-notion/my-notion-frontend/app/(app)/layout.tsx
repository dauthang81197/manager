import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';

/**
 * Logged-in shell (spine Code Map: "(app)/layout.tsx -- layout đã đăng nhập,
 * redirect /login nếu không có session, chứa Sidebar"). Every route nested
 * under this group (currently only pages/[pageId]) gets the tree sidebar and
 * requires a valid Auth.js session — same server-side `auth()` check story 1
 * introduced, just applied at the layout level instead of per page.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex flex-1 min-h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
