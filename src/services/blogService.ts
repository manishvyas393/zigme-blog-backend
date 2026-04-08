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
  approved?: boolean;
  rejected?: boolean;
  status?: BlogVersion["status"];
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
  htmlContent: string;
  status: BlogListStatus;
  approvedFlag: boolean;
  rejectedFlag: boolean;
  selectedNews: SelectedNews | null;
  sourceResults: SearchResult[];
  createdAt: Date;
  updatedAt: Date;
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
  blogGroupId: string;
  revision: number;
  site: BlogVersion["site"];
  prompt: string;
  searchQuery: string;
  title: string;
  summary: string;
  htmlContent: string;
  status: BlogVersion["status"];
  approvedFlag: boolean;
  rejectedFlag: boolean;
  reviewToken: string;
  selectedNews: SelectedNews | null;
  sourceResults: SearchResult[];
  generationNotes: string;
  createdAt: Date;
  updatedAt: Date;
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
    blogGroupId: blog.blog_group_id,
    revision: blog.revision,
    site: blog.site,
    prompt: blog.prompt,
    searchQuery: blog.search_query,
    title: blog.title,
    summary: blog.summary,
    htmlContent: blog.html_content,
    status: blog.status,
    approvedFlag: blog.approved_flag,
    rejectedFlag: blog.rejected_flag,
    reviewToken: blog.review_token,
    selectedNews: fromStoredSelectedNews(blog.selected_news),
    sourceResults: blog.source_results,
    generationNotes: blog.generation_notes,
    createdAt: blog.created_at,
    updatedAt: blog.updated_at
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
  const query: Partial<
    Pick<BlogVersion, "approved_flag" | "rejected_flag" | "status">
  > = {};

  if (typeof filters.approved === "boolean") {
    query.approved_flag = filters.approved;
  }

  if (typeof filters.rejected === "boolean") {
    query.rejected_flag = filters.rejected;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  const total = await BlogVersionModel.countDocuments(query);
  const items = await BlogVersionModel.find(query)
    .sort({ created_at: -1, revision: -1 })
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
    htmlContent: item.html_content,
    status: normalizeBlogListStatus(item.status),
    approvedFlag: item.approved_flag,
    rejectedFlag: item.rejected_flag,
    selectedNews: fromStoredSelectedNews(item.selected_news),
    sourceResults: item.source_results,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }));

  return {
    data,
    total,
    page,
    pages,
    limit: pagination.limit
  };
}
