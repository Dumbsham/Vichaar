import { TokenAction } from '@/components/token-action';

export default async function PreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="form-page">
      <p className="eyebrow">Email preferences</p>
      <h1>Choose your delivery time.</h1>
      <p className="form-intro">
        Your timezone applies to morning, afternoon, or evening delivery.
      </p>
      <TokenAction kind="preferences" token={token} />
    </div>
  );
}
