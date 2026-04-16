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

export interface BlogImageAttachment {
  name: string;
  type: string;
  size: number;
  data_url: string;
}

export interface BlogVersion {
  blog_group_id: string;
  revision: number;
  site: "hiring.zigme.in" | "talent.zigme.in";
  prompt: string;
  approval_email: string;
  word_range: "0-500" | "500-1000" | "1000-1500" | "1500-2000";
  search_query: string;
  title: string;
  summary: string;
  html_content: string;
  status: "draft" | "pending" | "approved" | "rejected";
  selected_news: StoredSelectedNews | null;
  attached_image: BlogImageAttachment | null;
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

const blogImageAttachmentSchema = new mongoose.Schema<BlogImageAttachment>(
  {
    name: { type: String, default: "" },
    type: { type: String, default: "" },
    size: { type: Number, default: 0 },
    data_url: { type: String, default: "" }
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
    approval_email: { type: String, default: "" },
    word_range: {
      type: String,
      enum: ["0-500", "500-1000", "1000-1500", "1500-2000"],
      default: "1000-1500"
    },
    search_query: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    html_content: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected"],
      default: "draft"
    },
    selected_news: { type: selectedNewsSchema, default: null },
    attached_image: { type: blogImageAttachmentSchema, default: null },
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
