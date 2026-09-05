import AdminKybConsole from '@/components/admin/AdminKybConsole';
import { listKybCases } from '@/lib/server/kyb';

export const dynamic = 'force-dynamic';

export default function AdminKybPage() {
  return <AdminKybConsole initialCases={listKybCases()} />;
}
