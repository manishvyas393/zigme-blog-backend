import mongoose, { HydratedDocument, Model } from "mongoose";

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SelectedNews {
  title: string;
  link: string;
  snippet: string;
  sourceName: string;
  publishedAt: string;
}

export interface StoredSelectedNews {
  title: string;
  link: string;
  snippet: string;
  source_name: string;
  published_at: string;
}

export interface BlogVersion {
  blog_group_id: string;
  revision: number;
  site: "hiring.zigme.in" | "talent.zigme.in";
  prompt: string;
  search_query: string;
  title: string;
  summary: string;
  html_content: string;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  approved_flag: boolean;
  rejected_flag: boolean;
  review_token: string;
  selected_news: StoredSelectedNews | null;
  source_results: SearchResult[];
  generation_notes: string;
  created_at: Date;
  updated_at: Date;
}

const searchResultSchema = new mongoose.Schema<SearchResult>(
  {
    title: { type: String, required: true },
    link: { type: String, required: true },
    snippet: { type: String, required: true }
  },
  { _id: false }
);

const selectedNewsSchema = new mongoose.Schema<StoredSelectedNews>(
  {
    title: { type: String, required: true },
    link: { type: String, required: true },
    snippet: { type: String, default: "" },
    source_name: { type: String, default: "" },
    published_at: { type: String, default: "" }
  },
  { _id: false }
);

const blogVersionSchema = new mongoose.Schema<BlogVersion>(
  {
    blog_group_id: { type: String, required: true, index: true },
    revision: { type: Number, required: true },
    site: {
      type: String,
      enum: ["hiring.zigme.in", "talent.zigme.in"],
      required: true
    },
    prompt: { type: String, required: true },
    search_query: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    html_content: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected"],
      default: "draft"
    },
    approved_flag: { type: Boolean, default: false },
    rejected_flag: { type: Boolean, default: false },
    review_token: { type: String, required: true, unique: true, index: true },
    selected_news: { type: selectedNewsSchema, default: null },
    source_results: { type: [searchResultSchema], default: [] },
    generation_notes: { type: String, default: "" }
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  }
);

export type BlogVersionDocument = HydratedDocument<BlogVersion>;

export const BlogVersionModel = mongoose.model<BlogVersion>(
  "BlogVersion",
  blogVersionSchema
) as Model<BlogVersion>;
