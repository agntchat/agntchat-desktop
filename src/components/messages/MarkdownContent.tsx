import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Components } from "react-markdown";

import { linkifyMarkdown } from "../../lib/linkify";
import { cn } from "../../lib/utils";

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline break-all hover:opacity-80"
    >
      {children}
    </a>
  ),
  // Paragraph margin roughly matches one line of body text so a `\n\n`
  // (user hitting shift+enter twice, or an agent's natural paragraph
  // break) renders as a visible blank line. Smaller margins like `mb-1`
  // collapse `\n\n` to look like a single `\n`.
  p: ({ children }) => <p className="mb-[1.25em] last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-current/30 pl-2 opacity-85">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="my-1 overflow-x-auto rounded-md bg-black/10 p-2 text-[12px] leading-tight dark:bg-white/10">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-black/10 px-1 py-0.5 text-[12px] dark:bg-white/10">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  ul: ({ children }) => (
    <ul className="my-1 list-disc pl-4 marker:text-current/50">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal pl-4 marker:text-current/50">{children}</ol>
  ),
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-2 text-base font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-2 text-[15px] font-bold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-0.5 mt-1 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  hr: () => <hr className="my-2 border-current/20" />,
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-current/20 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-current/10 px-2 py-1">{children}</td>
  ),
};

export function MarkdownContent({ content }: { content: string }) {
  // `remark-breaks` converts every single `\n` into a <br>, matching
  // Slack/Discord-style chat behaviour and mobile's raw-text rendering.
  // Plain CommonMark/GFM collapses single newlines to a space inside a
  // paragraph, which made shift+enter line breaks vanish here.
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {linkifyMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
