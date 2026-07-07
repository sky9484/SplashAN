import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import DashboardShell from '@/components/dashboard/DashboardShell';
import { getCustomerSession } from '@/lib/server/customer-auth';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getCustomerSession();

  if (!session) {
    redirect('/login');
  }

  return <DashboardShell session={session}>{children}</DashboardShell>;
}
