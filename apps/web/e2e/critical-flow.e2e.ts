import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';

const mailboxSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })),
      Subject: z.string(),
    }),
  ),
});
const messageSchema = z.object({ HTML: z.string() });

async function findMail(request: APIRequestContext, address: string, subject: string) {
  const list = await request.get('http://localhost:8025/api/v1/messages');
  if (!list.ok()) return null;
  const mailbox = mailboxSchema.parse(await list.json());
  const summary = mailbox.messages.find(
    (message) =>
      message.Subject === subject && message.To.some((recipient) => recipient.Address === address),
  );
  if (!summary) return null;
  const detail = await request.get(
    `http://localhost:8025/api/v1/message/${encodeURIComponent(summary.ID)}`,
  );
  return detail.ok() ? messageSchema.parse(await detail.json()) : null;
}

function linkFromEmail(html: string, path: 'confirm' | 'unsubscribe'): string {
  const match = html.match(
    new RegExp(`href="(https?://[^"<> ]+/${path}(?:\\?[^"<> ]+|/[^"<> ]+)?)"`),
  );
  if (!match?.[1]) throw new Error(`The local email has no ${path} link`);
  return match[1].replaceAll('&amp;', '&');
}

test('subscribe, confirm, publish, read, receive, unsubscribe, and see a paid preview', async ({
  page,
  browser,
  request,
}) => {
  const suffix = randomBytes(5).toString('hex');
  const subdomain = `f5-${suffix}`;
  const writerEmail = `f5-writer-${suffix}@example.test`;
  const readerEmail = `f5-reader-${suffix}@example.test`;
  const freeTitle = `A first letter ${suffix}`;
  const paidTitle = `A paid letter ${suffix}`;
  const publicDir = process.env.PUBLIC_HTML_DIR ?? './data/public-html';

  expect((await request.get('http://localhost:4000/readyz')).ok()).toBe(true);

  await page.goto('/signup?next=/studio');
  await page.getByRole('textbox', { name: 'Your name' }).fill('F5 Test Writer');
  await page.getByRole('textbox', { name: 'Email address' }).fill(writerEmail);
  await page.getByLabel('Password').fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/studio$/);

  await page.getByRole('textbox', { name: 'Publication name' }).fill('F5 Test Letters');
  await page.getByRole('textbox', { name: 'Public link name' }).fill(subdomain);
  await page.getByRole('button', { name: 'Create publication' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  const publicationId = page.url().split('/').at(-1);
  if (!publicationId) throw new Error('Missing publication ID');

  const reader = await browser.newPage();
  await reader.goto(`/p/${subdomain}`);
  await reader.getByRole('textbox', { name: 'Email address' }).fill(readerEmail);
  await reader.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(reader.getByRole('status')).toContainText('check your inbox');
  await expect
    .poll(
      async () =>
        Boolean(await findMail(request, readerEmail, 'Confirm your Vichaar subscription')),
      { timeout: 45_000 },
    )
    .toBe(true);
  const confirmation = await findMail(request, readerEmail, 'Confirm your Vichaar subscription');
  if (!confirmation) throw new Error('Confirmation email is missing');
  await reader.goto(linkFromEmail(confirmation.HTML, 'confirm'));
  await reader.getByRole('button', { name: 'Confirm subscription' }).click();
  await expect(reader.getByRole('status')).toContainText('Your email is confirmed');

  await page.goto(`/studio/${publicationId}/posts`);
  await page.getByRole('textbox', { name: 'New draft title' }).fill(freeTitle);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await page.locator('.tiptap').fill('The first letter is ready to read.');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish post' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
  const publicLink = page.getByRole('link', { name: 'Read public post' });
  await expect(publicLink).toBeVisible();
  const freeHref = await publicLink.getAttribute('href');
  if (!freeHref) throw new Error('Published post has no public link');
  await reader.goto(freeHref);
  await expect(reader.getByRole('heading', { name: freeTitle })).toBeVisible();
  await expect(reader.getByText('The first letter is ready to read.')).toBeVisible();
  const freeSlug = freeHref.split('/').at(-1);
  if (!freeSlug) throw new Error('Published post has no slug');
  const freeArtifact = join(publicDir, 'p', subdomain, freeSlug, 'index.html');
  await expect
    .poll(async () => readFile(freeArtifact, 'utf8').catch(() => ''), { timeout: 45_000 })
    .toContain('The first letter is ready to read.');

  await expect
    .poll(async () => Boolean(await findMail(request, readerEmail, freeTitle)), { timeout: 45_000 })
    .toBe(true);
  const delivery = await findMail(request, readerEmail, freeTitle);
  if (!delivery) throw new Error('Post email is missing');
  await reader.goto(linkFromEmail(delivery.HTML, 'unsubscribe'));
  await reader.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(reader.getByRole('status')).toContainText('unsubscribed');

  await page.getByRole('button', { name: 'Unpublish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Unpublished' })).toBeVisible();
  await expect
    .poll(
      async () =>
        stat(freeArtifact)
          .then(() => true)
          .catch(() => false),
      { timeout: 45_000 },
    )
    .toBe(false);

  await page.goto(`/studio/${publicationId}/posts`);
  await page.getByRole('textbox', { name: 'New draft title' }).fill(paidTitle);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await page.getByRole('checkbox', { name: 'Paid post' }).check();
  await page.locator('.tiptap').fill('A public opening.');
  await page.locator('.tiptap').press('End');
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').type('A private ending.');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish post' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
  const paidHref = await page.getByRole('link', { name: 'Read public post' }).getAttribute('href');
  if (!paidHref) throw new Error('Paid post has no public link');
  await reader.goto(paidHref);
  await expect(reader.getByText('A public opening.')).toBeVisible();
  await expect(reader.getByText('A private ending.')).toHaveCount(0);
  await expect(
    reader.getByRole('heading', { name: 'Continue reading with F5 Test Letters' }),
  ).toBeVisible();
  const paidSlug = paidHref.split('/').at(-1);
  if (!paidSlug) throw new Error('Paid post has no slug');
  const paidArtifact = join(publicDir, 'p', subdomain, paidSlug, 'index.html');
  await expect
    .poll(async () => readFile(paidArtifact, 'utf8').catch(() => ''), { timeout: 45_000 })
    .toContain('A public opening.');
  expect(await readFile(paidArtifact, 'utf8')).not.toContain('A private ending.');

  await reader.close();
});
