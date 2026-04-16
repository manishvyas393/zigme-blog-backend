import { OpenAI } from "openai";
import { config } from "../config.js";
import { LatestNewsCacheModel } from "../models/latestNewsCache.js";
import type { BlogImageAttachment, SearchResult, SelectedNews } from "../models/blogVersion.js";

const openai = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : null;
const LATEST_NEWS_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const LATEST_NEWS_MAX_AGE_DAYS = 3;
const NEWS_ITEMS_PER_SECTION = 5;
const NEWS_FETCH_REQUEST_COUNT = 12;

class ExternalServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ExternalServiceError";
    this.statusCode = statusCode;
  }
}

interface BlogGenerationResult {
  title: string;
  summary: string;
  htmlContent: string;
  generationNotes: string;
  sourceResults: SearchResult[];
}

type BlogWordRange = "0-500" | "500-1000" | "1000-1500" | "1500-2000";

function getWordRangeBounds(wordRange: BlogWordRange): { min: number; max: number } {
  switch (wordRange) {
    case "0-500":
      return { min: 0, max: 500 };
    case "500-1000":
      return { min: 500, max: 1000 };
    case "1000-1500":
      return { min: 1000, max: 1500 };
    case "1500-2000":
      return { min: 1500, max: 2000 };
    default:
      return { min: 500, max: 1000 };
  }
}

function getWordRangePlan(wordRange: BlogWordRange): {
  min: number;
  max: number;
  target: number;
  sections: string;
} {
  const { min, max } = getWordRangeBounds(wordRange);
  const target = Math.round((min + max) / 2);

  if (min >= 1500) {
    return { min, max, target, sections: "5-7" };
  }

  if (min >= 1000) {
    return { min, max, target, sections: "4-6" };
  }

  if (min >= 500) {
    return { min, max, target, sections: "3-4" };
  }

  return { min, max, target, sections: "2-3" };
}

interface LatestNewsResult {
  hiring: SelectedNews[];
  talent: SelectedNews[];
}

interface AIServiceResponse {
  output_text: string;
  output?: Array<{
    type?: string;
    action?: {
      sources?: Array<{
        url?: string;
        title?: string;
        snippet?: string;
        excerpt?: string;
      }>;
    };
  }>;
}

function normalizeUrl(value: unknown): string {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return "";
}

function buildResearchPrompt(site: string, prompt: string, wordRange: BlogWordRange): string {
  return `Research and write a professional, uncontroversial blog for ${site}.
Topic prompt: ${prompt}

Instructions:
- Search the web first and use the findings to ground the blog.
- Keep the article focused and practical.
- ${buildWordCountInstruction(wordRange)}
- Prefer practical, business-safe, non-controversial guidance.
- Avoid political, medical, legal, or sensational claims.
- Do not invent facts.
- Summarize clearly for business readers.
- Do not include markdown links anywhere in the response.
- Do not include raw source URLs anywhere in the response.
- Do not include inline citations, source names, or reference lists inside title, summary, or htmlContent.
- Use sources only for research grounding, not as visible output text.

Return JSON with exactly these keys:
title
summary
htmlContent
generationNotes`;
}

function buildWordCountInstruction(wordRange: BlogWordRange): string {
  const { min, max, target, sections } = getWordRangePlan(wordRange);

  switch (wordRange) {
    case "0-500":
      return `Hard requirement: keep the article between ${min} and ${max} words. Aim for about ${target} words and use ${sections} short sections.`;
    case "500-1000":
      return `Hard requirement: keep the article between ${min} and ${max} words. Aim for about ${target} words and use ${sections} focused sections.`;
    case "1000-1500":
      return `Hard requirement: keep the article between ${min} and ${max} words. Aim for about ${target} words and use ${sections} substantial sections.`;
    case "1500-2000":
      return `Hard requirement: keep the article between ${min} and ${max} words. Aim for about ${target} words and use ${sections} substantial sections.`;
    default:
      return `Hard requirement: keep the article between ${min} and ${max} words. Aim for about ${target} words.`;
  }
}

function countWords(value: string): number {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function requestBlogResponse({
  input,
  schemaName,
  useWebSearch
}: {
  input: string;
  schemaName: string;
  useWebSearch: boolean;
}): Promise<AIServiceResponse> {
  return (await openai!.responses.create({
    model: config.blogModel,
    ...(useWebSearch
      ? { include: ["web_search_call.action.sources"] as any, tools: [{ type: "web_search" }] }
      : {}),
    input,
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            htmlContent: { type: "string" },
            generationNotes: { type: "string" }
          },
          required: ["title", "summary", "htmlContent", "generationNotes"]
        }
      }
    }
  } as any)) as AIServiceResponse;
}

async function generateBlogWithRetries({
  site,
  prompt,
  wordRange,
  attachedImage,
  selectedNews,
  basePrompt,
  schemaName,
  useWebSearch
}: {
  site: string;
  prompt: string;
  wordRange: BlogWordRange;
  attachedImage?: BlogImageAttachment | null;
  selectedNews?: SelectedNews;
  basePrompt: string;
  schemaName: string;
  useWebSearch: boolean;
}): Promise<BlogGenerationResult> {
  const { min } = getWordRangePlan(wordRange);
  const maxAttempts = 3;
  let parsed: Omit<BlogGenerationResult, "sourceResults"> | null = null;
  let response: AIServiceResponse | null = null;
  let currentWordCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const input =
      attempt === 0
        ? basePrompt
        : buildExpansionPrompt(site, prompt, wordRange, selectedNews, currentWordCount);

    response = await requestBlogResponse({
      input,
      schemaName,
      useWebSearch
    });

    parsed = parseJsonText<Omit<BlogGenerationResult, "sourceResults">>(response.output_text);
    currentWordCount = countWords(parsed.htmlContent);

    if (currentWordCount >= min) {
      break;
    }
  }

  if (!parsed || !response) {
    throw new Error("Blog generation failed.");
  }

  return {
    ...parsed,
    htmlContent: prependFeaturedImage(parsed.htmlContent, attachedImage),
    sourceResults: useWebSearch ? extractSources(response) : []
  };
}

function buildExpansionPrompt(
  site: string,
  prompt: string,
  wordRange: BlogWordRange,
  selectedNews?: SelectedNews,
  currentWordCount?: number
): string {
  const { min, max, target, sections } = getWordRangePlan(wordRange);
  const newsContext = selectedNews
    ? `Selected news item:\nTitle: ${selectedNews.title}\nSnippet: ${selectedNews.snippet || ""}\n`
    : "";
  const wordCountContext =
    typeof currentWordCount === "number" ? `The previous draft was ${currentWordCount} words.\n` : "";

  return `You previously wrote a draft that was too short.

${wordCountContext}Rewrite the blog for ${site} so it is between ${min} and ${max} words.
Main topic prompt: ${prompt}

${newsContext}Instructions:
- Expand the article substantially.
- Aim for about ${target} words and use ${sections} clear sections.
- Add deeper explanation, practical examples, and a fuller conclusion.
- Keep the tone professional and business-safe.
- Do not add markdown links or raw URLs.
- Do not mention that this is a revision.

Return JSON with exactly these keys:
title
summary
htmlContent
generationNotes`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prependFeaturedImage(
  htmlContent: string,
  attachment?: BlogImageAttachment | null
): string {
  if (!attachment?.data_url) {
    return htmlContent;
  }

  const escapedName = escapeHtml(attachment.name || "Uploaded image");
  const imageMarkup = `
    <figure class="blog-feature-image">
      <img src="${attachment.data_url}" alt="${escapedName}" />
    </figure>
  `;

  return `${imageMarkup}${htmlContent}`;
}

function buildNewsPrompt(topic: string, count: number = 5): string {
  const today = new Date().toISOString().slice(0, 10);

  return `Search the web for the ${count} most recent important news items about: ${topic}

Instructions:
- Focus on the newest available news right now.
- Prefer items published today or within the last 24 hours.
- Only return items published today or within the last ${LATEST_NEWS_MAX_AGE_DAYS} days.
- If there are not enough, return fewer items instead of older ones.
- Prefer reputable publications.
- Return exactly ${count} items if possible.
- Keep each snippet short and factual.
- Use ISO-style date strings when a publication date is available.
- Do not return stale or evergreen results if fresher news is available.
- Today's date is ${today}.

Return JSON with exactly this shape:
{
  "items": [
    {
      "title": "string",
      "link": "string",
      "snippet": "string",
      "sourceName": "string",
      "publishedAt": "string"
    }
  ]
}`;
}

function buildNewsBasedBlogPrompt(
  site: string,
  prompt: string,
  selectedNews: SelectedNews,
  wordRange: BlogWordRange
): string {
  return `Research and write a professional, uncontroversial blog for ${site}.
Main topic prompt: ${prompt}

Selected news item:
Title: ${selectedNews.title}
Link: ${selectedNews.link}
Source: ${selectedNews.sourceName || "Unknown source"}
Published at: ${selectedNews.publishedAt || "Unknown date"}
Snippet: ${selectedNews.snippet || "No snippet provided"}

Instructions:
- Use the selected news item as the anchor for the article.
- Do not browse the web. Use only the selected news item and the topic prompt.
- Keep the article concise and practical.
- Use a short intro, 2-3 brief sections, and compact paragraphs.
- ${buildWordCountInstruction(wordRange)}
- Prefer practical, business-safe, non-controversial guidance.
- Avoid political, medical, legal, or sensational claims.
- Do not invent facts.
- Summarize clearly for business readers.
- Do not include markdown links anywhere in the response.
- Do not include raw source URLs anywhere in the response.
- Do not include inline citations, source names, or reference lists inside title, summary, or htmlContent.
- Use sources only for research grounding, not as visible output text.

Return JSON with exactly these keys:
title
summary
htmlContent
generationNotes`;
}

function extractSources(response: AIServiceResponse): SearchResult[] {
  const sourceMap = new Map<string, SearchResult>();

  for (const item of response.output || []) {
    if (item.type !== "web_search_call") {
      continue;
    }

    const sources = item.action?.sources || [];

    for (const source of sources) {
      const normalizedLink = normalizeUrl(source.url || "");

      if (!normalizedLink || sourceMap.has(normalizedLink)) {
        continue;
      }

      sourceMap.set(normalizedLink, {
        title: source.title || "Untitled result",
        link: normalizedLink,
        snippet: source.snippet || source.excerpt || "Source collected from OpenAI web search."
      });
    }
  }

  return Array.from(sourceMap.values()).slice(0, 8);
}

function parseJsonText<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseNewsDate(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getRecentNewsCutoff(): number {
  return Date.now() - LATEST_NEWS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function isRecentNewsItem(item: SelectedNews): boolean {
  const publishedAt = parseNewsDate(item.publishedAt);

  if (!publishedAt) {
    return false;
  }

  return publishedAt >= getRecentNewsCutoff();
}

function normalizeAndFilterRecentNews(items: SelectedNews[], count: number): SelectedNews[] {
  return items
    .map((item) => ({
      ...item,
      link: normalizeUrl(item.link)
    }))
    .filter((item) => item.link && isRecentNewsItem(item))
    .sort((left, right) => parseNewsDate(right.publishedAt) - parseNewsDate(left.publishedAt))
    .slice(0, count);
}

function splitLatestNews(items: SelectedNews[]): LatestNewsResult {
  return {
    hiring: items.slice(0, NEWS_ITEMS_PER_SECTION),
    talent: items.slice(NEWS_ITEMS_PER_SECTION, NEWS_ITEMS_PER_SECTION * 2)
  };
}

function mergeRecentNews(existing: SelectedNews[], incoming: SelectedNews[]): SelectedNews[] {
  const newsMap = new Map<string, SelectedNews>();

  for (const item of [...existing, ...incoming]) {
    const normalizedLink = normalizeUrl(item.link);

    if (!normalizedLink || !isRecentNewsItem({ ...item, link: normalizedLink })) {
      continue;
    }

    newsMap.set(normalizedLink, {
      ...item,
      link: normalizedLink
    });
  }

  return Array.from(newsMap.values()).sort(
    (left, right) => parseNewsDate(right.publishedAt) - parseNewsDate(left.publishedAt)
  );
}

async function fetchNewsForTopicWithRetries(topic: string, targetCount: number): Promise<SelectedNews[]> {
  const promptVariants = [
    topic,
    `${topic}, latest updates`,
    `${topic}, breaking news from the last 3 days`,
    `${topic}, recent developments`
  ];

  let collected: SelectedNews[] = [];

  for (const variant of promptVariants) {
    const fetched = await fetchNewsForTopic(variant, NEWS_FETCH_REQUEST_COUNT);
    collected = mergeRecentNews(collected, fetched);

    if (collected.length >= targetCount) {
      break;
    }
  }

  return collected.slice(0, targetCount);
}

function buildLatestNewsCacheKey(topic: string): string {
  return topic.trim().toLowerCase();
}

function isOpenAIQuotaError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
  const message = error instanceof Error ? error.message : String(error || "");

  return status === 429 || /exceeded your current quota|insufficient_quota|usage limit/i.test(message);
}

function toFriendlyOpenAIError(error: unknown): ExternalServiceError {
  if (isOpenAIQuotaError(error)) {
    return new ExternalServiceError(
      "OpenAI quota reached. Please check your OpenAI billing or usage limits, then try again.",
      429
    );
  }

  const message = error instanceof Error ? error.message : "OpenAI request failed.";
  return new ExternalServiceError(message, 502);
}

export async function generateBlog({
  site,
  prompt,
  wordRange,
  attachedImage
}: {
  site: string;
  prompt: string;
  wordRange: BlogWordRange;
  attachedImage?: BlogImageAttachment | null;
}): Promise<BlogGenerationResult> {
  if (!openai) {
    const placeholder = {
      title: `Draft blog for ${site}: ${prompt}`,
      summary: "OpenAI API key is missing, so this is a placeholder draft.",
      htmlContent: prependFeaturedImage(
        `
        <article>
          <h1>Draft blog for ${site}</h1>
          <p>This placeholder was created because <code>OPENAI_API_KEY</code> is not configured.</p>
          <h2>Requested topic</h2>
          <p>${prompt}</p>
        </article>
        `,
        attachedImage
      ),
      generationNotes: "Placeholder generated because OPENAI_API_KEY is not configured.",
      sourceResults: []
    };

    return placeholder;
  }

  try {
    return await generateBlogWithRetries({
      site,
      prompt,
      wordRange,
      attachedImage,
      basePrompt: buildResearchPrompt(site, prompt, wordRange),
      schemaName: "blog_generation",
      useWebSearch: true
    });
  } catch (error) {
    throw toFriendlyOpenAIError(error);
  }
}

async function fetchNewsForTopic(topic: string, count: number = 5): Promise<SelectedNews[]> {
  if (!openai) {
    return Array.from({ length: count }, (_, index) => ({
      title: `Placeholder latest news ${index + 1} for ${topic}`,
      link: "https://example.com/news-placeholder",
      snippet: "Configure OPENAI_API_KEY to fetch live latest news.",
      sourceName: "Placeholder",
      publishedAt: ""
    }));
  }

  try {
    const response = (await openai.responses.create({
      model: config.newsModel,
      include: ["web_search_call.action.sources"] as any,
      tools: [{ type: "web_search" }],
      input: buildNewsPrompt(topic, count),
      text: {
        format: {
          type: "json_schema",
          name: "latest_news",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    link: { type: "string" },
                    snippet: { type: "string" },
                    sourceName: { type: "string" },
                    publishedAt: { type: "string" }
                  },
                  required: ["title", "link", "snippet", "sourceName", "publishedAt"]
                }
              }
            },
            required: ["items"]
          }
        }
      }
    } as any)) as AIServiceResponse;

    const parsed = parseJsonText<{ items: SelectedNews[] }>(response.output_text);
    return normalizeAndFilterRecentNews(parsed.items.slice(0, count), count);
  } catch (error) {
    throw toFriendlyOpenAIError(error);
  }
}

export async function fetchLatestNews(topic: string): Promise<LatestNewsResult> {
  const cacheKey = buildLatestNewsCacheKey(topic);
  const cached = await LatestNewsCacheModel.findOne({
    cache_key: cacheKey,
    expires_at: { $gt: new Date() }
  }).lean();

  if (cached) {
    const recentItems = normalizeAndFilterRecentNews(cached.items, NEWS_ITEMS_PER_SECTION * 2);

    if (recentItems.length >= NEWS_ITEMS_PER_SECTION * 2) {
      return splitLatestNews(recentItems);
    }
  }

  const hiringTopic = "hiring strategies, recruitment trends, employer hiring, recruitment news, talent acquisition";
  const talentTopic = "campus drives, campus recruitment, fresher hiring, college placements, campus hiring news";

  const [hiringNews, talentNews] = await Promise.all([
    fetchNewsForTopicWithRetries(hiringTopic, NEWS_ITEMS_PER_SECTION),
    fetchNewsForTopicWithRetries(talentTopic, NEWS_ITEMS_PER_SECTION)
  ]);

  const cappedHiringNews = normalizeAndFilterRecentNews(hiringNews, NEWS_ITEMS_PER_SECTION);
  const cappedTalentNews = normalizeAndFilterRecentNews(talentNews, NEWS_ITEMS_PER_SECTION);
  const allItems = [...cappedHiringNews, ...cappedTalentNews];

  await LatestNewsCacheModel.findOneAndUpdate(
    { cache_key: cacheKey },
    {
      cache_key: cacheKey,
      topic,
      items: allItems,
      expires_at: new Date(Date.now() + LATEST_NEWS_CACHE_TTL_MS)
    },
    { upsert: true, new: true }
  );

  return {
    hiring: cappedHiringNews,
    talent: cappedTalentNews
  };
}

export async function generateBlogFromNews({
  site,
  prompt,
  selectedNews,
  wordRange,
  attachedImage
}: {
  site: string;
  prompt: string;
  selectedNews: SelectedNews;
  wordRange: BlogWordRange;
  attachedImage?: BlogImageAttachment | null;
}): Promise<BlogGenerationResult> {
  if (!openai) {
    const placeholder = {
      title: `Draft blog for ${site}: ${selectedNews.title}`,
      summary: "OpenAI API key is missing, so this is a placeholder draft.",
      htmlContent: prependFeaturedImage(
        `
        <article>
          <h1>${selectedNews.title}</h1>
          <p>This placeholder was created because <code>OPENAI_API_KEY</code> is not configured.</p>
          <p>${selectedNews.snippet || ""}</p>
        </article>
        `,
        attachedImage
      ),
      generationNotes: "Placeholder generated because OPENAI_API_KEY is not configured.",
      sourceResults: []
    };

    return placeholder;
  }

  try {
    return await generateBlogWithRetries({
      site,
      prompt,
      wordRange,
      attachedImage,
      selectedNews,
      basePrompt: buildNewsBasedBlogPrompt(site, prompt, selectedNews, wordRange),
      schemaName: "blog_generation_from_news",
      useWebSearch: false
    });
  } catch (error) {
    throw toFriendlyOpenAIError(error);
  }
}
