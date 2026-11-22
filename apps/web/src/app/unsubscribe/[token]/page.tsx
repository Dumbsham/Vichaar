import { TokenAction } from '@/components/token-action';

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="form-page">
      <p className="eyebrow">Email preferences</p>
      <h1>Leave this list.</h1>
      <p className="form-intro">
        You will stop receiving letters from this publication. This does not cancel a paid plan;
        manage that separately in your account.
      </p>
      <TokenAction kind="unsubscribe" token={token} />
    </div>
  );
}
