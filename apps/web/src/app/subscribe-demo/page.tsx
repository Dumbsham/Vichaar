import { redirect } from 'next/navigation';

export default async function OldConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  redirect(token ? `/confirm?token=${encodeURIComponent(token)}` : '/confirm');
}
