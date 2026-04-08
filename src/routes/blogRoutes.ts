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
}

interface LatestNewsBody {
  site?: string;
  topic?: string;
}

interface GenerateFromNewsBody {
  site?: string;
  prompt?: string;
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

function parseNonNegativeInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer.`);
  }

  return Number(value);
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
      const status = req.query["filter[status]"] ?? req.query.filter?.status;
      const platform = req.query["filter[platform]"] ?? req.query.filter?.platform;
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
        status: status === "pending" ? "pending_approval" : (status as
          | "draft"
          | "approved"
          | "rejected"
          | undefined),
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
      const { site, prompt } = req.body;

      if (!site || !prompt) {
        return res.status(400).json({ message: "Both site and prompt are required." });
      }

      const blog = await generateDraft({ site, prompt });
      return res.status(201).json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ message });
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
        items: news.items.map(serializeSelectedNews)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ message });
    }
  }
);

blogRouter.post(
  "/generate-from-news",
  async (req: Request<Record<string, never>, unknown, GenerateFromNewsBody>, res: Response) => {
    try {
      const { site, prompt } = req.body;
      const selectedNews = normalizeSelectedNewsInput(req.body.selectedNews);

      if (!site || !selectedNews?.title || !selectedNews?.link) {
        return res.status(400).json({ message: "Site and selected news are required." });
      }

      const blog = await generateDraftFromNews({
        site,
        prompt: prompt?.trim() || selectedNews.title,
        selectedNews
      });

      return res.status(201).json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ message });
    }
  }
);

blogRouter.post("/:id/send-for-approval", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const result = await sendForApproval(req.params.id);
    return res.json({
      blog: serializeBlog(result.blog),
      mail_result: result.mailResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ message });
  }
});

blogRouter.get(
  "/review/:reviewToken",
  async (req: Request<{ reviewToken: string }>, res: Response) => {
    try {
      const blog = await getBlogByReviewToken(req.params.reviewToken);
      return res.json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);

blogRouter.post(
  "/review/:reviewToken/approve",
  async (req: Request<{ reviewToken: string }>, res: Response) => {
    try {
      const blog = await approveByToken(req.params.reviewToken);
      return res.json(serializeBlog(blog));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);

blogRouter.post(
  "/review/:reviewToken/reject",
  async (req: Request<{ reviewToken: string }>, res: Response) => {
    try {
      const result = await rejectAndRegenerateByToken(req.params.reviewToken);
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
