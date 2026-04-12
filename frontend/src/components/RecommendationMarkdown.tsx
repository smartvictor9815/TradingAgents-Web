import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** GitHub-dark–aligned prose for investment rationale (matches AnalysisPage). */
const rationaleProseClass =
  "recommendation-md prose prose-sm max-w-none text-[#c9d1d9] " +
  "prose-headings:scroll-mt-20 prose-headings:font-semibold prose-headings:text-[#e6edf3] prose-headings:tracking-tight " +
  "prose-h1:text-base prose-h2:text-[15px] prose-h3:text-[13px] " +
  "prose-p:leading-[1.65] prose-p:my-2 first:prose-p:mt-0 last:prose-p:mb-0 " +
  "prose-a:text-[#58a6ff] prose-a:no-underline hover:prose-a:underline " +
  "prose-strong:text-[#e6edf3] prose-em:text-[#c9d1d9] " +
  "prose-code:rounded prose-code:border prose-code:border-[#30363d] prose-code:bg-[#161b22] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:font-normal prose-code:text-[#ffa657] prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:overflow-x-auto prose-pre:border prose-pre:border-[#30363d] prose-pre:bg-[#0a0e12] prose-pre:text-[#c9d1d9] " +
  "prose-blockquote:border-l-[#484f58] prose-blockquote:text-[#8b949e] " +
  "prose-hr:border-[#30363d] " +
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
  "prose-table:text-[12px] prose-th:border prose-th:border-[#30363d] prose-th:bg-[#161b22] prose-th:text-[#e6edf3] prose-th:px-2 prose-th:py-1.5 " +
  "prose-td:border prose-td:border-[#30363d] prose-td:px-2 prose-td:py-1.5";

type RecommendationMarkdownProps = {
  markdown: string;
  className?: string;
};

export function RecommendationMarkdown({
  markdown,
  className = "",
}: RecommendationMarkdownProps) {
  const md = markdown?.trim() ?? "";
  if (!md) {
    return (
      <p className="text-[13px] leading-[1.65] text-[#6e7681] italic">
        No rationale text.
      </p>
    );
  }

  return (
    <div className={`${rationaleProseClass} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}
