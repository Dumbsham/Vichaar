import { TokenAction } from '@/components/token-action';

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="form-page">
      <p className="eyebrow">Email confirmation</p>
      <h1>One click to finish.</h1>
      <p className="form-intro">
        Confirm that this address belongs to you before we send any letters.
      </p>
      {token ? (
        <TokenAction kind="confirm" token={token} />
      ) : (
        <p className="form-error">This confirmation link is missing its token.</p>
      )}
    </div>
  );
}
