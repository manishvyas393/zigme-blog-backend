import express, { Request, Response } from "express";
import {
  approveByToken,
  generateDraft,
  generateDraftFromNews,
  getBlogs,
  getLatestNews,
  getBlogByReviewToken,
  rejectAndRegenerateByToken,
  serializeBlog,
  sendForApproval
} from "../services/blogService.js";
import type { SelectedNews } from "../models/blogVersion.js";

interface GenerateBody {
  site?: string;
  prompt?: string;
  approvalEmail?: string;
  wordRange?: string;
  attachedImage?: {
    name?: string;
    type?: string;
    size?: number;
    dataUrl?: string;
    data_url?: string;
  };
}

interface SendForApprovalBody {
  approvalEmail?: string;
}

interface LatestNewsBody {
  site?: string;
  topic?: string;
}

interface GenerateFromNewsBody {
  site?: string;
  prompt?: string;
  approvalEmail?: string;
  wordRange?: string;
  attachedImage?: {
    name?: string;
    type?: string;
    size?: number;
    dataUrl?: string;
    data_url?: string;
  };
  selectedNews?: SelectedNews | {
    title?: string;
    link?: string;
    snippet?: string;
    source_name?: string;
    published_at?: string;
  };
}

type BlogStatus = "draft" | "pending" | "approved" | "rejected";

interface BlogListQuery {
  "filter[status]"?: string;
  "filter[platform]"?: string;
  filter?: {
    status?: string;
    platform?: string;
  };
  page?: string;
  pageNo?: string;
  limit?: string;
  skip?: string;
}

const validStatuses: BlogStatus[] = ["draft", "pending", "approved", "rejected"];
const validWordRanges = ["0-500", "500-1000", "1000-1500", "1500-2000"] as const;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeWordRange(value: unknown): "0-500" | "500-1000" | "1000-1500" | "1500-2000" {
  if (typeof value === "string" && (validWordRanges as readonly string[]).includes(value)) {
    return value as "0-500" | "500-1000" | "1000-1500" | "1500-2000";
  }

  return "1000-1500";
}

function normalizeAttachedImage(value: GenerateBody["attachedImage"]) {
  if (!value) {
    return null;
  }

  const dataUrl = value.dataUrl || value.data_url || "";
  const size = typeof value.size === "number" ? value.size : Number(value.size || 0);

  if (!dataUrl) {
    return null;
  }

  return {
    name: value.name || "Uploaded image",
    type: value.type || "",
    size,
    data_url: dataUrl
  };
}

function getResponseStatus(error: unknown, fallback: number): number {
  if (typeof error === "object" && error !== null) {
    const statusCode = (error as { statusCode?: number }).statusCode;

    if (typeof statusCode === "number") {
      return statusCode;
    }
  }

  return fallback;
}

function parseNonNegativeInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer.`);
  }

  return Number(value);
}

function getQueryParam(req: { originalUrl: string }, name: string): string | undefined {
  const searchParams = new URL(req.originalUrl, "http://localhost").searchParams;
  return searchParams.get(name) || undefined;
}

function serializeSelectedNews(selectedNews: SelectedNews) {
  return {
    title: selectedNews.title,
    link: selectedNews.link,
    snippet: selectedNews.snippet,
    source_name: selectedNews.sourceName,
    published_at: selectedNews.publishedAt
  };
}

function normalizeSelectedNewsInput(value: GenerateFromNewsBody["selectedNews"]): SelectedNews | null {
  if (!value) {
    return null;
  }

  return {
    title: value.title || "",
    link: value.link || "",
    snippet: value.snippet || "",
    sourceName: "sourceName" in value ? (value.sourceName || "") : (value.source_name || ""),
    publishedAt: "publishedAt" in value ? (value.publishedAt || "") : (value.published_at || "")
  };
}

export const blogRouter = express.Router();

blogRouter.get(
  "/",
  async (req: Request<Record<string, never>, unknown, unknown, BlogListQuery>, res: Response) => {
    try {
      const status =
        getQueryParam(req, "filter[status]") ??
        req.query.filter?.status;
      const platform =
        getQueryParam(req, "filter[platform]") ??
        req.query.filter?.platform;
      const page = parseNonNegativeInteger(req.query.page, "page");
      const pageNo = parseNonNegativeInteger(req.query.pageNo, "pageNo");
      const limit = parseNonNegativeInteger(req.query.limit, "limit") ?? 25;
      const skip =
        parseNonNegativeInteger(req.query.skip, "skip") ??
        ((pageNo ?? page ?? 0) * limit);

      if (status && !validStatuses.includes(status as BlogStatus)) {
        return res.status(400).json({
          message: "Status must be one of: draft, pending, approved, rejected."
        });
      }

      const blogs = await getBlogs({
        status: status as
          | "draft"
          | "pending"
          | "approved"
          | "rejected"
          | undefined,
        site:
          platform === "talent"
            ? "talent.zigme.in"
            : platform === "hiring"
              ? "hiring.zigme.in"
              : undefined
      }, {
        skip,
        limit
      });

      return res.json(blogs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(400).json({ message });
    }
  }
);

blogRouter.post(
  "/generate",
  async (req: Request<Record<string, never>, unknown, GenerateBody>, res: Response) => {
    try {
      const { site, prompt, approvalEmail } = req.body;
      const wordRange = normalizeWordRange(req.body.wordRange);
      const attachedImage = normalizeAttachedImage(req.body.attachedImage);

      if (!site || !prompt) {
        return res.status(400).json({ message: "Both site and prompt are required." });
      }

      if (approvalEmail && !isValidEmail(approvalEmail.trim())) {
        return res.status(400).json({ message: "Approval email must be a valid email address." });
      }

      if (attachedImage?.size && attachedImage.size > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Attached image must be 5 MB or smaller." });
      }

      const blog = await generateDraft({
        site,
        prompt,
        approvalEmail: approvalEmail?.trim(),
        wordRange,
        attachedImage
      });
      return res.status(201).json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(getResponseStatus(error, 500)).json({ message });
    }
  }
);

blogRouter.post(
  "/latest-news",
  async (req: Request<Record<string, never>, unknown, LatestNewsBody>, res: Response) => {
    try {
      const { site, topic } = req.body;

      if (!site) {
        return res.status(400).json({ message: "Site is required." });
      }

      const news = await getLatestNews({ site, topic });
      return res.json({
        hiring: news.hiring.map(serializeSelectedNews),
        talent: news.talent.map(serializeSelectedNews)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(getResponseStatus(error, 500)).json({ message });
    }
  }
);

blogRouter.post(
  "/generate-from-news",
  async (req: Request<Record<string, never>, unknown, GenerateFromNewsBody>, res: Response) => {
    try {
      const { site, prompt, approvalEmail } = req.body;
      const selectedNews = normalizeSelectedNewsInput(req.body.selectedNews);
      const wordRange = normalizeWordRange(req.body.wordRange);
      const attachedImage = normalizeAttachedImage(req.body.attachedImage);

      if (!site || !selectedNews?.title || !selectedNews?.link) {
        return res.status(400).json({ message: "Site and selected news are required." });
      }

      if (approvalEmail && !isValidEmail(approvalEmail.trim())) {
        return res.status(400).json({ message: "Approval email must be a valid email address." });
      }

      if (attachedImage?.size && attachedImage.size > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Attached image must be 5 MB or smaller." });
      }

      const blog = await generateDraftFromNews({
        site,
        prompt: prompt?.trim() || selectedNews.title,
        selectedNews,
        approvalEmail: approvalEmail?.trim(),
        wordRange,
        attachedImage
      });

      return res.status(201).json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(getResponseStatus(error, 500)).json({ message });
    }
  }
);

blogRouter.post(
  "/:id/send-for-approval",
  async (req: Request<{ id: string }, unknown, SendForApprovalBody>, res: Response) => {
  try {
    const result = await sendForApproval(req.params.id, req.body.approvalEmail);
    return res.json({
      blog: serializeBlog(result.blog),
      mail_result: result.mailResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(getResponseStatus(error, 500)).json({ message });
  }
});

blogRouter.get(
  "/review/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const blog = await getBlogByReviewToken(req.params.id);
      return res.json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);

blogRouter.post(
  "/review/:id/approve",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const blog = await approveByToken(req.params.id);
      return res.json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);

blogRouter.post(
  "/review/:id/reject",
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const result = await rejectAndRegenerateByToken(req.params.id);
      return res.json({
        rejected_blog: serializeBlog(result.rejectedBlog),
        regenerated_blog: serializeBlog(result.regeneratedBlog),
        mail_result: result.mailResult
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);
