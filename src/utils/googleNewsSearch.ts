import type { SelectedNews } from "../models/blogVersion.js";

const DEFAULT_GOOGLE_NEWS_PARAMS = {
  hl: "en-IN",
  gl: "IN",
  ceid: "IN:en"
} as const;

const SEARCH_WINDOW_DAYS = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function cleanText(value: string): string {
  return stripTags(decodeHtmlEntities(value))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string): string {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return "";
}

function getRecentCutoffDays(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildGoogleNewsQuery(topic: string, ageDays: number): string {
  const trimmedTopic = topic.trim();
  const ageFilter = ageDays > 0 ? ` when:${ageDays}d` : "";
  return `${trimmedTopic}${ageFilter}`.trim();
}

function buildGoogleNewsUrl(query: string): string {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", DEFAULT_GOOGLE_NEWS_PARAMS.hl);
  url.searchParams.set("gl", DEFAULT_GOOGLE_NEWS_PARAMS.gl);
  url.searchParams.set("ceid", DEFAULT_GOOGLE_NEWS_PARAMS.ceid);
  return url.toString();
}

function extractTag(block: string, tagName: string): string {
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(tagPattern);
  return match?.[2] ? match[2].trim() : "";
}

function extractTagAttribute(block: string, tagName: string, attributeName: string): string {
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)>`, "i");
  const match = block.match(tagPattern);

  if (!match?.[1]) {
    return "";
  }

  const attrPattern = new RegExp(`${escapeRegExp(attributeName)}=["']([^"']+)["']`, "i");
  const attrMatch = match[1].match(attrPattern);
  return attrMatch?.[1] ? attrMatch[1].trim() : "";
}

function extractItems(xml: string): string[] {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi), (match) => match[0]);
}

function parseGoogleNewsFeed(xml: string): SelectedNews[] {
  const items = extractItems(xml);
  const seen = new Map<string, SelectedNews>();

  for (const item of items) {
    const title = cleanText(extractTag(item, "title"));
    const description = cleanText(extractTag(item, "description"));
    const sourceName = cleanText(extractTag(item, "source")) || "Google News";
    const sourceUrl = normalizeUrl(decodeHtmlEntities(extractTagAttribute(item, "source", "url")));
    const itemLink = normalizeUrl(decodeHtmlEntities(extractTag(item, "link")));
    const link = sourceUrl || itemLink;
    const publishedAt = cleanText(extractTag(item, "pubDate"));

    if (!title || !link) {
      continue;
    }

    const normalizedLink = link;

    if (seen.has(normalizedLink)) {
      continue;
    }

    seen.set(normalizedLink, {
      title,
      link: normalizedLink,
      snippet: description || title,
      sourceName,
      publishedAt,
      imageUrl: ""
    });
  }

  return Array.from(seen.values()).sort((left, right) => parseDate(right.publishedAt) - parseDate(left.publishedAt));
}

async function fetchGoogleNewsFeed(query: string): Promise<SelectedNews[]> {
  const url = buildGoogleNewsUrl(query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ZigMeNewsBot/1.0)"
      }
    });

    if (!response.ok) {
      throw new Error(`Google News request failed with status ${response.status}.`);
    }

    const xml = await response.text();
    return parseGoogleNewsFeed(xml);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAndMergeNews(items: SelectedNews[]): SelectedNews[] {
  const deduped = new Map<string, SelectedNews>();

  for (const item of items) {
    const link = normalizeUrl(item.link);

    if (!link) {
      continue;
    }

    deduped.set(link, {
      ...item,
      link
    });
  }

  return Array.from(deduped.values()).sort(
    (left, right) => parseDate(right.publishedAt) - parseDate(left.publishedAt)
  );
}

export async function searchGoogleNews(topic: string, count: number = 5): Promise<SelectedNews[]> {
  const queryVariants = [
    buildGoogleNewsQuery(topic, SEARCH_WINDOW_DAYS),
    buildGoogleNewsQuery(topic, SEARCH_WINDOW_DAYS * 2),
    buildGoogleNewsQuery(topic, 0)
  ];

  const collected: SelectedNews[] = [];

  for (const query of queryVariants) {
    const items = await fetchGoogleNewsFeed(query);
    collected.push(...items);

    const merged = normalizeAndMergeNews(collected);
    const recent = merged.filter((item) => parseDate(item.publishedAt) >= getRecentCutoffDays(SEARCH_WINDOW_DAYS));

    if (recent.length >= count) {
      return recent.slice(0, count);
    }
  }

  return normalizeAndMergeNews(collected).slice(0, count);
}
