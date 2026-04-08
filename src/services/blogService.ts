import {
  BlogVersionModel,
  type BlogVersion,
  type BlogVersionDocument,
  type SearchResult,
  type SelectedNews,
  type StoredSelectedNews
} from "../models/blogVersion.js";
import { fetchLatestNews, generateBlog, generateBlogFromNews } from "./aiService.js";
import { sendApprovalEmail } from "./mailService.js";
import { generateId, generateReviewToken } from "../utils/tokens.js";

interface CreateVersionInput {
  blogGroupId: string;
  revision: number;
  site: string;
  prompt: string;
  selectedNews?: SelectedNews | null;
}

interface BlogFilters {
  status?: BlogVersion["status"];
  site?: BlogVersion["site"];
}

interface BlogPagination {
  skip: number;
  limit: number;
}

type BlogListStatus = "pending" | "approved" | "rejected";

interface PublicBlogListItem {
  _id: string;
  site: BlogVersion["site"];
  prompt: string;
  title: string;
  summary: string;
  html_content: string;
  status: BlogListStatus;
  created_at: Date;
  updated_at: Date;
}

interface BlogListResult {
  data: PublicBlogListItem[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

interface PublicBlog {
  _id: string;
  blog_group_id: string;
  revision: number;
  site: BlogVersion["site"];
  prompt: string;
  search_query: string;
  title: string;
  summary: string;
  html_content: string;
  status: BlogVersion["status"];
  approved_flag: boolean;
  rejected_flag: boolean;
  review_token: string;
  selected_news: StoredSelectedNews | null;
  source_results: SearchResult[];
  generation_notes: string;
  created_at: Date;
  updated_at: Date;
}

function sanitizeSelectedNews(selectedNews: SelectedNews | null | undefined): SelectedNews | null {
  if (!selectedNews) {
    return null;
  }

  const link = typeof selectedNews.link === "string" ? selectedNews.link.trim() : "";
  const safeLink = /^https?:\/\//i.test(link) ? link : "";

  return {
    title: selectedNews.title || "",
    link: safeLink,
    snippet: selectedNews.snippet || "",
    sourceName: selectedNews.sourceName || "",
    publishedAt: selectedNews.publishedAt || ""
  };
}

function toStoredSelectedNews(
  selectedNews: SelectedNews | null | undefined
): StoredSelectedNews | null {
  if (!selectedNews) {
    return null;
  }

  return {
    title: selectedNews.title,
    link: selectedNews.link,
    snippet: selectedNews.snippet,
    source_name: selectedNews.sourceName,
    published_at: selectedNews.publishedAt
  };
}

function fromStoredSelectedNews(selectedNews: StoredSelectedNews | null | undefined): SelectedNews | null {
  if (!selectedNews) {
    return null;
  }

  return {
    title: selectedNews.title,
    link: selectedNews.link,
    snippet: selectedNews.snippet,
    sourceName: selectedNews.source_name,
    publishedAt: selectedNews.published_at
  };
}

export function serializeBlog(blog: BlogVersionDocument): PublicBlog {
  return {
    _id: String(blog._id),
    blog_group_id: blog.blog_group_id,
    revision: blog.revision,
    site: blog.site,
    prompt: blog.prompt,
    search_query: blog.search_query,
    title: blog.title,
    summary: blog.summary,
    html_content: blog.html_content,
    status: blog.status,
    approved_flag: blog.approved_flag,
    rejected_flag: blog.rejected_flag,
    review_token: blog.review_token,
    selected_news: blog.selected_news,
    source_results: blog.source_results,
    generation_notes: blog.generation_notes,
    created_at: blog.created_at,
    updated_at: blog.updated_at
  };
}

function defaultNewsTopicForSite(site: string): string {
  if (site === "talent.zigme.in") {
    return "latest news about talent acquisition, workforce trends, skills, and careers";
  }

  return "latest news about hiring, recruitment, HR technology, and employer branding";
}

async function createVersion({
  blogGroupId,
  revision,
  site,
  prompt,
  selectedNews = null
}: CreateVersionInput): Promise<BlogVersionDocument> {
  const safeSelectedNews = sanitizeSelectedNews(selectedNews);
  const generated = safeSelectedNews
    ? await generateBlogFromNews({
        site,
        prompt,
        selectedNews: safeSelectedNews
      })
    : await generateBlog({
        site,
        prompt
      });

  const blog = await BlogVersionModel.create({
    blog_group_id: blogGroupId,
    revision,
    site,
    prompt,
    search_query: prompt,
    selected_news: toStoredSelectedNews(safeSelectedNews),
    title: generated.title,
    summary: generated.summary,
    html_content: generated.htmlContent,
    source_results: generated.sourceResults,
    generation_notes: generated.generationNotes,
    review_token: generateReviewToken()
  });

  return blog;
}

export async function generateDraft({
  site,
  prompt
}: {
  site: string;
  prompt: string;
}): Promise<BlogVersionDocument> {
  const blogGroupId = generateId();

  return createVersion({
    blogGroupId,
    revision: 1,
    site,
    prompt
  });
}

export async function getLatestNews({
  site,
  topic
}: {
  site: string;
  topic?: string;
}) {
  return fetchLatestNews(topic || defaultNewsTopicForSite(site));
}

export async function generateDraftFromNews({
  site,
  prompt,
  selectedNews
}: {
  site: string;
  prompt: string;
  selectedNews: SelectedNews;
}): Promise<BlogVersionDocument> {
  const blogGroupId = generateId();
  const safeSelectedNews = sanitizeSelectedNews(selectedNews);

  return createVersion({
    blogGroupId,
    revision: 1,
    site,
    prompt,
    selectedNews: safeSelectedNews
  });
}

export async function sendForApproval(versionId: string) {
  const blog = await BlogVersionModel.findById(versionId);

  if (!blog) {
    throw new Error("Blog version not found.");
  }

  blog.status = "pending_approval";
  await blog.save();

  const mailResult = await sendApprovalEmail(blog);

  return { blog, mailResult };
}

export async function approveByToken(reviewToken: string): Promise<BlogVersionDocument> {
  const blog = await BlogVersionModel.findOne({ review_token: reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  blog.status = "approved";
  blog.approved_flag = true;
  blog.rejected_flag = false;
  await blog.save();

  return blog;
}

export async function rejectAndRegenerateByToken(reviewToken: string) {
  const blog = await BlogVersionModel.findOne({ review_token: reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  blog.status = "rejected";
  blog.rejected_flag = true;
  blog.approved_flag = false;
  await blog.save();

  const nextRevision = await createVersion({
    blogGroupId: blog.blog_group_id,
    revision: blog.revision + 1,
    site: blog.site,
    prompt: blog.prompt,
    selectedNews: fromStoredSelectedNews(blog.selected_news)
  });

  nextRevision.status = "pending_approval";
  await nextRevision.save();

  const mailResult = await sendApprovalEmail(nextRevision);

  return { rejectedBlog: blog, regeneratedBlog: nextRevision, mailResult };
}

export async function getBlogByReviewToken(reviewToken: string): Promise<BlogVersionDocument> {
  const blog = await BlogVersionModel.findOne({ review_token: reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  return blog;
}

export async function getBlogs(
  filters: BlogFilters = {},
  pagination: BlogPagination = { skip: 0, limit: 25 }
): Promise<BlogListResult> {
  const query: Partial<Pick<BlogVersion, "status" | "site">> = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.site) {
    query.site = filters.site;
  }

  const total = await BlogVersionModel.countDocuments(query);
  const items = await BlogVersionModel.find(query)
    .sort({ updated_at: -1, created_at: -1, revision: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit);

  const page = pagination.limit > 0 ? Math.floor(pagination.skip / pagination.limit) : 0;
  const pages = pagination.limit > 0 ? Math.ceil(total / pagination.limit) : 0;
  const normalizeBlogListStatus = (status: BlogVersion["status"]): BlogListStatus => {
    if (status === "approved" || status === "rejected") {
      return status;
    }

    return "pending";
  };

  const data = items.map((item) => ({
    _id: String(item._id),
    site: item.site,
    prompt: item.prompt,
    title: item.title,
    summary: item.summary,
    html_content: item.html_content,
    status: normalizeBlogListStatus(item.status),
    created_at: item.created_at,
    updated_at: item.updated_at
  }));

  return {
    data,
    total,
    page,
    pages,
    limit: pagination.limit
  };
}
