import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { normalizeCompatibilityHtml } from "../html/compatibility.js";
import { parseCompatibilityHtml } from "../html/compatibility.js";

type MarkdownHtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: MarkdownHtmlNode[];
  value?: string;
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const extractFormulaPlaceholders = (markdown: string) => {
  const formulas: string[] = [];
  const source = markdown.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_match, block, inline) => {
    const value = String(block ?? inline ?? "").trim();
    if (!value) return _match;
    const index = formulas.push(value) - 1;
    return `SMART_RTE_FORMULA_${index}_TOKEN`;
  });
  return { source, formulas };
};

/**
 * Converts CommonMark/GFM input to canonical Smart RTE HTML.
 *
 * This is intentionally separate from HTML import. Markdown provides list
 * indentation and table syntax that no HTML repair pass can recover once lost.
 */
export const markdownToCompatibilityHtml = (markdown: string): string => {
  const { source, formulas } = extractFormulaPlaceholders(markdown);
  const html = String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(source),
  );
  const withFormulas = formulas.reduce(
    (current, formula, index) => current.replace(
      new RegExp(`SMART_RTE_FORMULA_${index}_TOKEN`, "g"),
      `<span data-formula="${escapeAttribute(formula)}">$${escapeAttribute(formula)}$</span>`,
    ),
    html,
  );
  const withChecklists = withFormulas
    .replace(/<ul class="contains-task-list">/g, '<ul data-srte-checklist="true">')
    .replace(
      /<li class="task-list-item"><input type="checkbox"([^>]*)>\s*/g,
      (_match, attributes) =>
        `<li data-srte-checked="${/\bchecked(?:\s|=|$)/.test(attributes) ? "true" : "false"}">`,
    );
  return normalizeCompatibilityHtml(withChecklists);
};

const attr = (node: MarkdownHtmlNode, name: string) =>
  node.attrs?.find((candidate) => candidate.name === name)?.value || "";

const markdownEscapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/([*_`[\]])/g, "\\$1");

const descendantsByTag = (node: MarkdownHtmlNode, tagName: string): MarkdownHtmlNode[] =>
  (node.childNodes || []).flatMap((child) => [
    ...(child.tagName === tagName ? [child] : []),
    ...descendantsByTag(child, tagName),
  ]);

/** Converts canonical HTML to portable GFM with Smart RTE formula syntax. */
export const compatibilityHtmlToMarkdown = (html: string): string => {
  const { fragment } = parseCompatibilityHtml(html);
  const walk = (node: MarkdownHtmlNode, listDepth = 0): string => {
    if (node.nodeName === "#text") return markdownEscapeText(node.value || "");
    const tag = node.tagName || "";
    if (tag === "span" && attr(node, "data-formula")) return `$${attr(node, "data-formula")}$`;
    if (tag === "img") return `![${markdownEscapeText(attr(node, "alt"))}](${attr(node, "src")})`;
    const content = (node.childNodes || []).map((child) => walk(child, listDepth)).join("");
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "s" || tag === "del" || tag === "strike") return `~~${content}~~`;
    if (tag === "code") return `\`${content}\``;
    if (tag === "a") return `[${content}](${attr(node, "href")})`;
    if (tag === "br") return "  \n";
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${content.trim()}\n\n`;
    if (tag === "p") return `${content.trim()}\n\n`;
    if (tag === "blockquote") {
      return `${content.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "li") {
      return `${"  ".repeat(listDepth)}- ${content.trim()}\n`;
    }
    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      const checklist = attr(node, "data-srte-checklist") === "true";
      return (node.childNodes || []).map((child, index) => {
        if (child.tagName !== "li") return walk(child, listDepth + 1);
        const item = (child.childNodes || []).map((nested) => walk(nested, listDepth + 1)).join("").trim();
        const marker = checklist
          ? `- [${attr(child, "data-srte-checked") === "true" ? "x" : " "}]`
          : ordered ? `${index + 1}.` : "-";
        return `${"  ".repeat(listDepth)}${marker} ${item}\n`;
      }).join("") + (listDepth === 0 ? "\n" : "");
    }
    if (tag === "table") {
      const rows = descendantsByTag(node, "tr").map((row) =>
        (row.childNodes || [])
          .filter((cell) => cell.tagName === "td" || cell.tagName === "th")
          .map((cell) => (cell.childNodes || []).map((child) => walk(child, listDepth)).join("")
            .replace(/\n+/g, " ").trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const columns = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => [...row, ...Array(Math.max(0, columns - row.length)).fill("")]);
      return [
        `| ${normalized[0].join(" | ")} |`,
        `| ${Array(columns).fill("---").join(" | ")} |`,
        ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
        "",
        "",
      ].join("\n");
    }
    return content;
  };
  return walk(fragment as MarkdownHtmlNode).replace(/\n{3,}/g, "\n\n").trim();
};
