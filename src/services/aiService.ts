import { OpenAI } from "openai";
import { config } from "../config.js";
import { LatestNewsCacheModel } from "../models/latestNewsCache.js";
import type { SearchResult, SelectedNews } from "../models/blogVersion.js";

const openai = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : null;
const LATEST_NEWS_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

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

interface LatestNewsResult {
  items: SelectedNews[];
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

function buildResearchPrompt(site: string, prompt: string): string {
  return `Research and write a professional, uncontroversial blog for ${site}.
Topic prompt: ${prompt}

Instructions:
- Search the web first and use the findings to ground the blog.
- Keep the article concise and practical.
- Use a short intro, 2-3 brief sections, and compact paragraphs.
- Aim for roughly 400-600 words.
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

function buildNewsPrompt(topic: string): string {
  const today = new Date().toISOString().slice(0, 10);

  return `Search the web for the 10 most recent important news items about: ${topic}

Instructions:
- Focus on the newest available news right now.
- Prefer items published today or within the last 24 hours.
- If there are not enough, include the next most recent items.
- Prefer reputable publications.
- Return exactly 10 items if possible.
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

function buildNewsBasedBlogPrompt(site: string, prompt: string, selectedNews: SelectedNews): string {
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
- Aim for roughly 400-600 words.
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
  prompt
}: {
  site: string;
  prompt: string;
}): Promise<BlogGenerationResult> {
  if (!openai) {
    return {
      title: `Draft blog for ${site}: ${prompt}`,
      summary: "OpenAI API key is missing, so this is a placeholder draft.",
      htmlContent: `
        <article>
          <h1>Draft blog for ${site}</h1>
          <p>This placeholder was created because <code>OPENAI_API_KEY</code> is not configured.</p>
          <h2>Requested topic</h2>
          <p>${prompt}</p>
        </article>
      `,
      generationNotes: "Placeholder generated because OPENAI_API_KEY is not configured.",
      sourceResults: []
    };
  }

  try {
    const response = (await openai.responses.create({
      model: config.blogModel,
      include: ["web_search_call.action.sources"] as any,
      tools: [{ type: "web_search" }],
      input: buildResearchPrompt(site, prompt),
      text: {
        format: {
          type: "json_schema",
          name: "blog_generation",
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

    const parsed = parseJsonText<Omit<BlogGenerationResult, "sourceResults">>(response.output_text);

    return {
      ...parsed,
      sourceResults: extractSources(response)
    };
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
    return {
      items: cached.items
    };
  }

  if (!openai) {
    const items = Array.from({ length: 10 }, (_, index) => ({
        title: `Placeholder latest news ${index + 1} for ${topic}`,
        link: "https://example.com/news-placeholder",
        snippet: "Configure OPENAI_API_KEY to fetch live latest news.",
        sourceName: "Placeholder",
        publishedAt: ""
      }));

    await LatestNewsCacheModel.findOneAndUpdate(
      { cache_key: cacheKey },
      {
        cache_key: cacheKey,
        topic,
        items,
        expires_at: new Date(Date.now() + LATEST_NEWS_CACHE_TTL_MS)
      },
      { upsert: true, new: true }
    );

    return { items };
  }

  try {
    const response = (await openai.responses.create({
      model: config.newsModel,
      include: ["web_search_call.action.sources"] as any,
      tools: [{ type: "web_search" }],
      input: buildNewsPrompt(topic),
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

    const parsed = parseJsonText<LatestNewsResult>(response.output_text);
    const items = parsed.items
      .slice(0, 10)
      .map((item) => ({
        ...item,
        link: normalizeUrl(item.link)
      }))
      .filter((item) => item.link)
      .sort((left, right) => parseNewsDate(right.publishedAt) - parseNewsDate(left.publishedAt));

    await LatestNewsCacheModel.findOneAndUpdate(
      { cache_key: cacheKey },
      {
        cache_key: cacheKey,
        topic,
        items,
        expires_at: new Date(Date.now() + LATEST_NEWS_CACHE_TTL_MS)
      },
      { upsert: true, new: true }
    );

    return {
      items
    };
  } catch (error) {
    throw toFriendlyOpenAIError(error);
  }
}

export async function generateBlogFromNews({
  site,
  prompt,
  selectedNews
}: {
  site: string;
  prompt: string;
  selectedNews: SelectedNews;
}): Promise<BlogGenerationResult> {
  if (!openai) {
    return {
      title: `Draft blog for ${site}: ${selectedNews.title}`,
      summary: "OpenAI API key is missing, so this is a placeholder draft.",
      htmlContent: `
        <article>
          <h1>${selectedNews.title}</h1>
          <p>This placeholder was created because <code>OPENAI_API_KEY</code> is not configured.</p>
          <p>${selectedNews.snippet || ""}</p>
        </article>
      `,
      generationNotes: "Placeholder generated because OPENAI_API_KEY is not configured.",
      sourceResults: []
    };
  }

  try {
    const response = (await openai.responses.create({
      model: config.blogModel,
      input: buildNewsBasedBlogPrompt(site, prompt, selectedNews),
      text: {
        format: {
          type: "json_schema",
          name: "blog_generation_from_news",
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

    const parsed = parseJsonText<Omit<BlogGenerationResult, "sourceResults">>(response.output_text);

    return {
      ...parsed,
      sourceResults: []
    };
  } catch (error) {
    throw toFriendlyOpenAIError(error);
  }
}
