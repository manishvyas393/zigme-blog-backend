import {
  BlogVersionModel,
  type BlogVersionDocument,
  type SelectedNews
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
    blogGroupId,
    revision,
    site,
    prompt,
    searchQuery: prompt,
    selectedNews: safeSelectedNews,
    title: generated.title,
    summary: generated.summary,
    htmlContent: generated.htmlContent,
    sourceResults: generated.sourceResults,
    generationNotes: generated.generationNotes,
    reviewToken: generateReviewToken()
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
  const blog = await BlogVersionModel.findOne({ reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  blog.status = "approved";
  blog.approvedFlag = true;
  blog.rejectedFlag = false;
  await blog.save();

  return blog;
}

export async function rejectAndRegenerateByToken(reviewToken: string) {
  const blog = await BlogVersionModel.findOne({ reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  blog.status = "rejected";
  blog.rejectedFlag = true;
  blog.approvedFlag = false;
  await blog.save();

  const nextRevision = await createVersion({
    blogGroupId: blog.blogGroupId,
    revision: blog.revision + 1,
    site: blog.site,
    prompt: blog.prompt,
    selectedNews: blog.selectedNews
  });

  nextRevision.status = "pending_approval";
  await nextRevision.save();

  const mailResult = await sendApprovalEmail(nextRevision);

  return { rejectedBlog: blog, regeneratedBlog: nextRevision, mailResult };
}

export async function getBlogByReviewToken(reviewToken: string): Promise<BlogVersionDocument> {
  const blog = await BlogVersionModel.findOne({ reviewToken });

  if (!blog) {
    throw new Error("Review token not found.");
  }

  return blog;
}
