import { redirect } from 'next/navigation';

export default async function OldPostPage({
  params,
}: {
  params: Promise<{ subdomain: string; slug: string }>;
}) {
  const { subdomain, slug } = await params;
  redirect(`/p/${encodeURIComponent(subdomain)}/${encodeURIComponent(slug)}`);
}
