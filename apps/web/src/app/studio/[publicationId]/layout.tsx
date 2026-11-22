import { StudioFrame } from '@/components/studio-frame';

export default async function PublicationStudioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ publicationId: string }>;
}) {
  const { publicationId } = await params;
  return <StudioFrame id={publicationId}>{children}</StudioFrame>;
}
