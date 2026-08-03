const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

export interface SafeLinkAttrs {
  href: string;
  target?: string;
}

export type NormalizedLinkKind = "url" | "email" | "phone" | "anchor" | "invalid";

export interface NormalizedLinkResult {
  kind: NormalizedLinkKind;
  href: string | null;
  input: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bareDomainPattern = /^(?:www\.)?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+(?:[/?#][^\s]*)?$/;
const phonePattern = /^\+?[\d\s().-]{7,}$/;

const normalizePhone = (value: string) => {
  const hasLeadingPlus = value.trim().startsWith("+");
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
};

export const normalizeLinkInput = (input: string | undefined | null): NormalizedLinkResult => {
  const trimmed = input?.trim() || "";
  if (!trimmed) return { kind: "invalid", href: null, input: "" };
  if (/^mailto:/i.test(trimmed)) {
    const email = trimmed.slice("mailto:".length).trim();
    const href = emailPattern.test(email) ? `mailto:${email}` : null;
    return { kind: href ? "email" : "invalid", href, input: trimmed };
  }
  if (/^tel:/i.test(trimmed)) {
    const phone = normalizePhone(trimmed.slice("tel:".length));
    const href = phone ? `tel:${phone}` : null;
    return { kind: href ? "phone" : "invalid", href, input: trimmed };
  }
  if (emailPattern.test(trimmed)) return { kind: "email", href: `mailto:${trimmed}`, input: trimmed };
  const phone = normalizePhone(trimmed);
  if (phone && (trimmed.startsWith("+") || phonePattern.test(trimmed))) {
    return { kind: "phone", href: `tel:${phone}`, input: trimmed };
  }
  if (/^#[A-Za-z][\w:.-]*$/.test(trimmed)) return { kind: "anchor", href: trimmed, input: trimmed };
  if (bareDomainPattern.test(trimmed)) return { kind: "url", href: `https://${trimmed}`, input: trimmed };
  try {
    const parsed = new URL(trimmed);
    const href = allowedProtocols.has(parsed.protocol) ? trimmed : null;
    return { kind: href ? "url" : "invalid", href, input: trimmed };
  } catch {
    return { kind: "invalid", href: null, input: trimmed };
  }
};

export const sanitizeLinkHref = (href: string | undefined | null): string | null => normalizeLinkInput(href).href;

export const sanitizeLinkTarget = (target: string | undefined): string | undefined => target?.trim() || undefined;

export const sanitizeLinkAttrs = (input: { href?: string; target?: string }): SafeLinkAttrs | null => {
  const href = sanitizeLinkHref(input.href);
  return href ? { href, target: sanitizeLinkTarget(input.target) } : null;
};
