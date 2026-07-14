import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { normalizeCompatibilityHtml } from "../html/compatibility.js";

/**
 * Converts CommonMark/GFM input to canonical Smart RTE HTML.
 *
 * This is intentionally separate from HTML import. Markdown provides list
 * indentation and table syntax that no HTML repair pass can recover once lost.
 */
export const markdownToCompatibilityHtml = (markdown: string): string => {
  const html = String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(markdown),
  );

  return normalizeCompatibilityHtml(html);
};
