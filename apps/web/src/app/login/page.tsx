import { AuthForm } from '@/components/auth-form';
import { safeReturnPath } from '@/lib/safe-return';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="login" nextPath={safeReturnPath(next)} />;
}
