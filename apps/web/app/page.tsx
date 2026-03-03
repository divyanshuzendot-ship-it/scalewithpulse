import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get('adbuffs_internal_auth')?.value === '1';

  redirect(isAuthenticated ? '/dashboard' : '/login');
}
