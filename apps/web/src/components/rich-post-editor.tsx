'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useEffect } from 'react';

export default function RichPostEditor({
  body,
  onChange,
  disabled,
}: {
  body: string;
  onChange: (html: string) => void;
  disabled: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false }),
    ],
    content: body,
    editable: !disabled,
    onUpdate: ({ editor: updated }) => onChange(updated.getHTML()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    if (editor && editor.getHTML() !== body)
      editor.commands.setContent(body, { emitUpdate: false });
  }, [editor, body]);
  if (!editor) return <p role="status">Opening editor…</p>;
  const link = () => {
    const current = editor.getAttributes('link').href;
    const url = window.prompt(
      'Link URL (https://)',
      typeof current === 'string' ? current : 'https://',
    );
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported link');
      editor.chain().focus().extendMarkRange('link').setLink({ href: parsed.toString() }).run();
    } catch {
      window.alert('Use an http or https link.');
    }
  };
  return (
    <div className="post-editor-surface">
      <div className="post-toolbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          aria-label="Heading"
          aria-pressed={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          Heading
        </button>
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor.isActive('bold')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor.isActive('italic')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Quote"
          aria-pressed={editor.isActive('blockquote')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </button>
        <button
          type="button"
          aria-label="List"
          aria-pressed={editor.isActive('bulletList')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </button>
        <button
          type="button"
          aria-label="Link"
          aria-pressed={editor.isActive('link')}
          disabled={disabled}
          onClick={link}
        >
          Link
        </button>
      </div>
      <EditorContent editor={editor} aria-label="Post body" />
    </div>
  );
}
