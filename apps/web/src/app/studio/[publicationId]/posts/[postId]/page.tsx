import { StudioPostEditor } from '@/components/studio-post-editor';

export default async function PostEditorPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  return <StudioPostEditor postId={postId} />;
}
