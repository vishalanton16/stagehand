import { lazy, Suspense } from "react";

const Markdown = lazy(() =>
  import("@pierre/words/react").then(({ Markdown }) => ({ default: Markdown })),
);
const blockedElements = ["img"];

function safeLink(url: string, key: "href" | "src") {
  if (key !== "href") return;
  if (url.startsWith("#")) return url;
  const link = URL.parse(url);
  if (link && ["https:", "http:"].includes(link.protocol) && !link.username && !link.password) {
    return link.href;
  }
}

const components = {
  a: (html: string) =>
    /\bhref="https?:/.test(html)
      ? html.replace(/^<a\b/, '<a target="_blank" rel="noreferrer"')
      : html,
};

export function MarkdownText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <Suspense fallback={<pre>{text}</pre>}>
      <Markdown
        className="markdown-text"
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        controls={{ code: { copy: true, download: false } }}
        disallowedElements={blockedElements}
        urlTransform={safeLink}
        components={components}
      >
        {text}
      </Markdown>
    </Suspense>
  );
}
