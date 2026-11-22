import { AccountSubscriptions } from '@/components/account-subscriptions';

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ publicationId?: string }>;
}) {
  const { publicationId } = await searchParams;
  return <AccountSubscriptions publicationId={publicationId} />;
}
