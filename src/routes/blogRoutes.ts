import express, { Request, Response } from "express";
import {
  approveByToken,
  generateDraft,
  generateDraftFromNews,
  getBlogs,
  getLatestNews,
  getBlogByReviewToken,
  rejectAndRegenerateByToken,
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
  selectedNews?: SelectedNews;
}

type BlogStatus = "draft" | "pending_approval" | "approved" | "rejected";

interface BlogListQuery {
  "filter[approved]"?: string;
  "filter[rejected]"?: string;
  "filter[status]"?: string;
}

const validStatuses: BlogStatus[] = ["draft", "pending_approval", "approved", "rejected"];

function parseBooleanFilter(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("Boolean filters must be 'true' or 'false'.");
}

export const blogRouter = express.Router();

blogRouter.get(
  "/",
  async (req: Request<Record<string, never>, unknown, unknown, BlogListQuery>, res: Response) => {
    try {
      const approved = parseBooleanFilter(req.query["filter[approved]"]);
      const rejected = parseBooleanFilter(req.query["filter[rejected]"]);
      const status = req.query["filter[status]"];

      if (status && !validStatuses.includes(status as BlogStatus)) {
        return res.status(400).json({
          message: "Status must be one of: draft, pending_approval, approved, rejected."
        });
      }

      const blogs = await getBlogs({
        approved,
        rejected,
        status: status as BlogStatus | undefined
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
      return res.status(201).json(blog);
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
      return res.json(news);
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
      const { site, prompt, selectedNews } = req.body;

      if (!site || !selectedNews?.title || !selectedNews?.link) {
        return res.status(400).json({ message: "Site and selected news are required." });
      }

      const blog = await generateDraftFromNews({
        site,
        prompt: prompt?.trim() || selectedNews.title,
        selectedNews
      });

      return res.status(201).json(blog);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ message });
    }
  }
);

blogRouter.post("/:id/send-for-approval", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const result = await sendForApproval(req.params.id);
    return res.json(result);
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
      return res.json(blog);
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
      return res.json(blog);
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
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(404).json({ message });
    }
  }
);
