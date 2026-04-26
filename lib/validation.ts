const FEATURED_HEADING_RE = /^## (?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*)/gim;
const FEATURED_SECTION_RE =
  /## (?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*)(.+?)\n\n([\s\S]*?)(?=\n---|\n## (?!\s*(?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*))|$)/i;
const FEATURED_HEADING_LABEL_RE = /^(?:🔥(?:\s*Featured Story:)?|Noticia principal:)\s*/i;

export function extractFeatured(
  content: string
): { category: string; headline: string; body: string; firstUrl: string | null } | null {
  const match = content.match(FEATURED_SECTION_RE);
  if (!match?.[1] || !match[2]) return null;
  const headline = match[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const rawBody = (match[2].trim().split("\n\n")[0] ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const body = rawBody.length > 280 ? rawBody.slice(0, 280).replace(/\S+$/, "").trimEnd() + "…" : rawBody;
  const urlMatch = match[2].match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const firstUrl = urlMatch?.[2] ?? null;
  return { category: "Noticia Principal", headline, body, firstUrl };
}

export { FEATURED_HEADING_RE, FEATURED_HEADING_LABEL_RE };

export type CurationValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type CurationValidationResult = {
  valid: boolean;
  errors: CurationValidationIssue[];
  warnings: CurationValidationIssue[];
  stats: {
    headings: number;
    sections: number;
    stories: number;
    links: number;
    duplicateLinks: number;
    readingTime: number;
  };
};

function pushIssue(
  list: CurationValidationIssue[],
  severity: CurationValidationIssue["severity"],
  code: string,
  message: string
) {
  list.push({ severity, code, message });
}

export function estimateReadingTime(raw: string): number {
  const words = raw.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function validateCurationContent(content: string): CurationValidationResult {
  const errors: CurationValidationIssue[] = [];
  const warnings: CurationValidationIssue[] = [];
  const trimmed = content.trim();

  if (trimmed.length < 10) {
    pushIssue(errors, "error", "content_too_short", "El contenido debe tener al menos 10 caracteres.");
  }
  if (content.length > 1_000_000) {
    pushIssue(errors, "error", "content_too_large", "El contenido no puede superar 1.000.000 caracteres.");
  }

  const hasFrontmatterStart = content.startsWith("---\n");
  if (hasFrontmatterStart && !content.match(/^---\n[\s\S]*?\n---\n/)) {
    pushIssue(errors, "error", "frontmatter_unclosed", "El frontmatter empieza con --- pero no tiene cierre válido.");
  }
  if (!hasFrontmatterStart) {
    pushIssue(warnings, "warning", "frontmatter_missing", "Se recomienda incluir frontmatter aunque sea solo image_url.");
  }

  const h1Count = (content.match(/^# .+$/gm) || []).length;
  if (h1Count === 0) {
    pushIssue(warnings, "warning", "title_missing", "Se recomienda incluir un título H1 al inicio de la edición.");
  } else if (h1Count > 1) {
    pushIssue(warnings, "warning", "multiple_titles", "La edición debería tener un solo título H1.");
  }

  const featured = extractFeatured(content);
  if (!featured) {
    pushIssue(
      errors,
      "error",
      "featured_missing",
      "Falta la sección destacada con heading ## Noticia principal: ..."
    );
  } else {
    if (featured.headline.length < 12) {
      pushIssue(errors, "error", "featured_headline_short", "El titular destacado es demasiado corto.");
    }
    if (featured.body.length < 80) {
      pushIssue(warnings, "warning", "featured_excerpt_short", "La historia destacada debería tener un primer párrafo más descriptivo.");
    }
    if (!featured.firstUrl) {
      pushIssue(warnings, "warning", "featured_link_missing", "La historia destacada no contiene un link principal.");
    }
  }

  const h2Headings = Array.from(content.matchAll(/^## (.+)$/gm)).map((m) => m[1]?.trim() ?? "");
  const sections = h2Headings.filter((h) => !FEATURED_HEADING_LABEL_RE.test(h)).length;
  if (sections === 0) {
    pushIssue(errors, "error", "sections_missing", "Debe existir al menos una sección H2 además de la historia destacada.");
  }

  const h3Matches = Array.from(content.matchAll(/^### (.+)$/gm));
  const stories = h3Matches.length;
  if (stories === 0) {
    pushIssue(errors, "error", "stories_missing", "Debe existir al menos una historia con heading H3.");
  } else if (stories < 3) {
    pushIssue(warnings, "warning", "few_stories", "La edición tiene pocas historias; revisa si está completa.");
  }

  const links = Array.from(content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map((m) => m[2]?.trim() ?? "");
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const href of links) {
    if (seen.has(href)) duplicates.add(href);
    seen.add(href);
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        pushIssue(errors, "error", "unsafe_link_protocol", `Link con protocolo no permitido: ${href}`);
      }
    } catch {
      if (!href.startsWith("/") && !href.startsWith("#")) {
        pushIssue(warnings, "warning", "relative_or_invalid_link", `Link relativo o inválido: ${href}`);
      }
    }
  }
  if (duplicates.size > 0) {
    pushIssue(warnings, "warning", "duplicate_links", `Hay ${duplicates.size} link(s) duplicado(s).`);
  }

  if (/<script[\s>]/i.test(content) || /on\w+=["']/i.test(content)) {
    pushIssue(warnings, "warning", "raw_html_detected", "Se detectó HTML potencialmente riesgoso; será escapado al renderizar.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      headings: (content.match(/^#{1,6} .+$/gm) || []).length,
      sections,
      stories,
      links: links.length,
      duplicateLinks: duplicates.size,
      readingTime: estimateReadingTime(content),
    },
  };
}
