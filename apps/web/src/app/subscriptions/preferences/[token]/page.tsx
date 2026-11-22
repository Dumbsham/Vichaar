import { redirect } from 'next/navigation';

export default async function OldPreferencesPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/preferences/${encodeURIComponent(token)}`);
}
