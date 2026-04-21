import {
  BlogVersionModel,
  type BlogImageAttachment,
  type BlogVersion,
  type BlogVersionDocument,
  type SearchResult,
  type SelectedNews,
  type StoredSelectedNews
} from "../models/blogVersion.js";
import { fetchLatestNews, generateBlog, generateBlogFromNews } from "./aiService.js";
import { sendApprovalEmail } from "./mailService.js";
import { generateId } from "../utils/tokens.js";

interface CreateVersionInput {
  blogGroupId?: string;
  revision: number;
  site: string;
  prompt: string;
  approvalEmail?: string;
  wordRange: BlogVersion["word_range"];
  attachedImage?: BlogImageAttachment | null;
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

type BlogListStatus = "draft" | "pending" | "approved" | "rejected";

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
  approval_email: string;
  word_range: BlogVersion["word_range"];
  search_query: string;
  title: string;
  summary: string;
  html_content: string;
  status: BlogVersion["status"];
  selected_news: StoredSelectedNews | null;
  attached_image: BlogImageAttachment | null;
  source_results: SearchResult[];
  generation_notes: string;
  created_at: Date;
  updated_at: Date;
}

function normalizeWordRange(value: unknown): BlogVersion["word_range"] {
  if (value === "0-500" || value === "1000-1500" || value === "1500-2000") {
    return value;
  }

  return "1000-1500";
}

function validateApprovalEmail(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Approval email is required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Approval email must be a valid email address.");
  }

  return trimmed;
}

function normalizeAttachedImage(attachedImage?: BlogImageAttachment | null): BlogImageAttachment | null {
  if (!attachedImage?.data_url) {
    return null;
  }

  return {
    name: attachedImage.name || "Uploaded image",
    type: attachedImage.type || "",
    size: Number(attachedImage.size) || 0,
    data_url: attachedImage.data_url
  };
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
    approval_email: blog.approval_email,
    word_range: blog.word_range,
    search_query: blog.search_query,
    title: blog.title,
    summary: blog.summary,
    html_content: blog.html_content,
    status: blog.status,
    selected_news: blog.selected_news,
    attached_image: blog.attached_image,
    source_results: blog.source_results,
    generation_notes: blog.generation_notes,
    created_at: blog.created_at,
    updated_at: blog.updated_at
  };
}

async function createVersion({
  blogGroupId,
  revision,
  site,
  prompt,
  approvalEmail,
  wordRange,
  attachedImage,
  selectedNews = null
}: CreateVersionInput): Promise<BlogVersionDocument> {
  const safeSelectedNews = sanitizeSelectedNews(selectedNews);
  const safeWordRange = normalizeWordRange(wordRange);
  const safeAttachedImage = normalizeAttachedImage(attachedImage);
  const generated = safeSelectedNews
    ? await generateBlogFromNews({
        site,
        prompt,
        selectedNews: safeSelectedNews,
        wordRange: safeWordRange,
        attachedImage: safeAttachedImage
      })
    : await generateBlog({
        site,
        prompt,
        wordRange: safeWordRange,
        attachedImage: safeAttachedImage
      });

  const blog = await BlogVersionModel.create({
    blog_group_id: blogGroupId || generateId(),
    revision,
    site,
    prompt,
    approval_email: "",
    word_range: safeWordRange,
    search_query: prompt,
    selected_news: toStoredSelectedNews(safeSelectedNews),
    attached_image: safeAttachedImage,
    title: generated.title,
    summary: generated.summary,
    html_content: generated.htmlContent,
    source_results: generated.sourceResults,
    generation_notes: generated.generationNotes,
  });

  if (!blogGroupId) {
    blog.blog_group_id = String(blog._id);
    await blog.save();
  }

  return blog;
}

export async function generateDraft({
  site,
  prompt,
  approvalEmail,
  wordRange,
  attachedImage
}: {
  site: string;
  prompt: string;
  approvalEmail?: string;
  wordRange: BlogVersion["word_range"];
  attachedImage?: BlogImageAttachment | null;
}): Promise<BlogVersionDocument> {
  return createVersion({
    revision: 1,
    site,
    prompt,
    approvalEmail,
    wordRange,
    attachedImage
  });
}

export async function getLatestNews({
  site,
  topic
}: {
  site: string;
  topic?: string;
}) {
  return fetchLatestNews(site || topic || "");
}

export async function generateDraftFromNews({
  site,
  prompt,
  selectedNews,
  approvalEmail,
  wordRange,
  attachedImage
}: {
  site: string;
  prompt: string;
  selectedNews: SelectedNews;
  approvalEmail?: string;
  wordRange: BlogVersion["word_range"];
  attachedImage?: BlogImageAttachment | null;
}): Promise<BlogVersionDocument> {
  const safeSelectedNews = sanitizeSelectedNews(selectedNews);

  return createVersion({
    revision: 1,
    site,
    prompt,
    approvalEmail,
    wordRange,
    attachedImage,
    selectedNews: safeSelectedNews
  });
}

export async function sendForApproval(versionId: string, approvalEmail?: string) {
  const blog = await BlogVersionModel.findById(versionId);

  if (!blog) {
    throw new Error("Blog version not found.");
  }

  if (approvalEmail) {
    blog.approval_email = validateApprovalEmail(approvalEmail);
  }

  blog.status = "pending";
  await blog.save();

  const mailResult = await sendApprovalEmail(blog);

  return { blog, mailResult };
}

export async function approveByToken(id: string): Promise<BlogVersionDocument> {
  const blog = await BlogVersionModel.findById(id);

  if (!blog) {
    throw new Error("Review blog not found.");
  }

  blog.status = "approved";
  await blog.save();

  return blog;
}

export async function rejectAndRegenerateByToken(id: string) {
  const blog = await BlogVersionModel.findById(id);

  if (!blog) {
    throw new Error("Review blog not found.");
  }

  blog.status = "rejected";
  await blog.save();

  const nextRevision = await createVersion({
    blogGroupId: blog.blog_group_id,
    revision: blog.revision + 1,
    site: blog.site,
    prompt: blog.prompt,
    approvalEmail: blog.approval_email,
    wordRange: blog.word_range,
    attachedImage: blog.attached_image,
    selectedNews: fromStoredSelectedNews(blog.selected_news)
  });

  nextRevision.status = "pending";
  await nextRevision.save();

  const mailResult = await sendApprovalEmail(nextRevision);

  return { rejectedBlog: blog, regeneratedBlog: nextRevision, mailResult };
}

export async function getBlogByReviewToken(id: string): Promise<BlogVersionDocument> {
  const blog = await BlogVersionModel.findById(id);

  if (!blog) {
    throw new Error("Review blog not found.");
  }

  return blog;
}

export async function getBlogBySelectedNewsLink({
  site,
  newsLink
}: {
  site: string;
  newsLink: string;
}): Promise<BlogVersionDocument | null> {
  const trimmedLink = newsLink.trim();

  if (!trimmedLink) {
    return null;
  }

  return BlogVersionModel.findOne({
    site,
    "selected_news.link": trimmedLink
  }).sort({ updated_at: -1, created_at: -1, revision: -1 });
}

export async function getBlogsBySelectedNewsLink({
  site,
  newsLink
}: {
  site: string;
  newsLink: string;
}): Promise<BlogVersionDocument[]> {
  const trimmedLink = newsLink.trim();

  if (!trimmedLink) {
    return [];
  }

  return BlogVersionModel.find({
    site,
    "selected_news.link": trimmedLink
  }).sort({ updated_at: -1, created_at: -1, revision: -1 });
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

  const data = items.map((item) => ({
    _id: String(item._id),
    site: item.site,
    prompt: item.prompt,
    title: item.title,
    summary: item.summary,
    html_content: item.html_content,
    status: (item.status === "draft" ? "draft" : item.status === "pending" ? "pending" : item.status === "approved" ? "approved" : "rejected") as BlogListStatus,
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
