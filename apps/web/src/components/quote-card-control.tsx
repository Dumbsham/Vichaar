'use client';

import { useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { apiRequest, errorMessage } from '@/lib/api/browser';
import { normalizeQuoteText, quoteLength } from '@/lib/quote';

const cardSchema = z.object({ url: z.string(), cached: z.boolean() });

function selectedQuote(container: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode)
    return '';
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode))
    return '';
  return normalizeQuoteText(selection.toString());
}

export function QuoteCardControl({
  subdomain,
  slug,
  children,
}: {
  subdomain: string;
  slug: string;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tooLong = quoteLength(quote) > 200;

  function updateSelection() {
    if (!bodyRef.current) return;
    const next = selectedQuote(bodyRef.current);
    if (!next) return;
    setQuote(next);
    setCardUrl('');
    setMessage(quoteLength(next) > 200 ? 'Select a shorter passage (up to 200 characters).' : '');
  }

  async function createCard() {
    if (!normalizeQuoteText(quote) || tooLong || busy) return;
    setBusy(true);
    setMessage('');
    setCardUrl('');
    try {
      const result = await apiRequest(
        `/public/${encodeURIComponent(subdomain)}/posts/${encodeURIComponent(slug)}/quote-cards`,
        cardSchema,
        { method: 'POST', body: { quote: normalizeQuoteText(quote) } },
      );
      const expectedPrefix = `/public/${encodeURIComponent(subdomain)}/posts/${encodeURIComponent(slug)}/quote-cards/`;
      if (!result.url.startsWith(expectedPrefix) || !/\/[0-9a-f]{64}\.png$/.test(result.url))
        throw new Error('Unexpected quote card URL');
      setCardUrl(`/api${result.url}`);
      setMessage('Quote card ready.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div ref={bodyRef} onPointerUp={updateSelection} onKeyUp={updateSelection}>
        {children}
      </div>
      <section className="quote-card-control" aria-label="Share a quote">
        <p>Select a passage in the letter to make a shareable image.</p>
        <label htmlFor="quote-card-text">Passage from this letter</label>
        <textarea
          id="quote-card-text"
          value={quote}
          rows={3}
          onChange={(event) => {
            setQuote(event.target.value);
            setCardUrl('');
            setMessage('');
          }}
          aria-describedby="quote-card-help"
          aria-invalid={tooLong}
        />
        <p id="quote-card-help">
          You can also paste a passage here. It must appear in the letter and be at most 200
          characters.
        </p>
        {tooLong && <p role="alert">This passage is over 200 characters. Select a shorter part.</p>}
        <button
          className="text-button"
          type="button"
          disabled={!normalizeQuoteText(quote) || tooLong || busy}
          onClick={() => void createCard()}
        >
          {busy ? 'Making image…' : 'Make quote card'}
        </button>
        {message && <p role="status">{message}</p>}
        {cardUrl && (
          <div className="quote-card-result">
            {/* The API renders the PNG and checks that its source post is still published. */}
            <img
              src={cardUrl}
              alt={`Quote card: ${normalizeQuoteText(quote)}`}
              onError={() => {
                setCardUrl('');
                setMessage('This image is unavailable. Try making the card again.');
              }}
            />
            <a className="read-link" href={cardUrl} download="vichaar-quote.png">
              Download image
            </a>
          </div>
        )}
      </section>
    </>
  );
}
