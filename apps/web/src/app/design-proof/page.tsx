import type { Metadata } from 'next';
import { PublicationHeader } from '@/components/publication-header';
import { PostListItem } from '@/components/post-list-item';

export const metadata: Metadata = {
  title: 'Reading layout study',
  robots: { index: false, follow: false },
};

const publication = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'The Sunday Letter',
  subdomain: 'design-proof',
  description: 'Notes on ordinary days, language, and the things we carry home.',
  language: 'en',
  monthlyPricePaise: 0,
};

const posts = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'a-room-for-thought',
    title: 'A room for thought',
    language: 'en',
    isPaid: false,
    publishedAt: '2026-11-15T09:00:00.000Z',
    excerpt:
      'A small note on making space for the sentences that stay with us after the day is done.',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    slug: 'ghar-ki-baat',
    title: 'घर की बात, धीरे-धीरे',
    language: 'hi',
    isPaid: false,
    publishedAt: '2026-11-08T09:00:00.000Z',
    excerpt:
      'कुछ बातें जल्दी में नहीं लिखी जा सकतीं। उन्हें सुबह की चाय और थोड़ी सी ख़ामोशी चाहिए।',
  },
];

export default function DesignProof() {
  return (
    <div className="reading-page">
      <p className="proof-label">Design study · sample writing, not a live publication</p>
      <PublicationHeader publication={publication} preview />
      <section className="letters-section" aria-labelledby="latest-heading">
        <div className="section-heading">
          <span>01 / The letters</span>
          <h2 id="latest-heading">Latest writing</h2>
        </div>
        <div className="post-list">
          {posts.map((post) => (
            <PostListItem key={post.id} post={post} subdomain={publication.subdomain} preview />
          ))}
        </div>
        <p className="script-sample" lang="ta">
          சில வார்த்தைகள் நம்முடன் நீண்ட நேரம் தங்குகின்றன.
        </p>
      </section>
    </div>
  );
}
