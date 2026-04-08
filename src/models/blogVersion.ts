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

export interface BlogVersion {
  blogGroupId: string;
  revision: number;
  site: "hiring.zigme.in" | "talent.zigme.in";
  prompt: string;
  searchQuery: string;
  title: string;
  summary: string;
  htmlContent: string;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  approvedFlag: boolean;
  rejectedFlag: boolean;
  reviewToken: string;
  selectedNews: SelectedNews | null;
  sourceResults: SearchResult[];
  generationNotes: string;
  createdAt: Date;
  updatedAt: Date;
}

const searchResultSchema = new mongoose.Schema<SearchResult>(
  {
    title: { type: String, required: true },
    link: { type: String, required: true },
    snippet: { type: String, required: true }
  },
  { _id: false }
);

const selectedNewsSchema = new mongoose.Schema<SelectedNews>(
  {
    title: { type: String, required: true },
    link: { type: String, required: true },
    snippet: { type: String, default: "" },
    sourceName: { type: String, default: "" },
    publishedAt: { type: String, default: "" }
  },
  { _id: false }
);

const blogVersionSchema = new mongoose.Schema<BlogVersion>(
  {
    blogGroupId: { type: String, required: true, index: true },
    revision: { type: Number, required: true },
    site: {
      type: String,
      enum: ["hiring.zigme.in", "talent.zigme.in"],
      required: true
    },
    prompt: { type: String, required: true },
    searchQuery: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    htmlContent: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected"],
      default: "draft"
    },
    approvedFlag: { type: Boolean, default: false },
    rejectedFlag: { type: Boolean, default: false },
    reviewToken: { type: String, required: true, unique: true, index: true },
    selectedNews: { type: selectedNewsSchema, default: null },
    sourceResults: { type: [searchResultSchema], default: [] },
    generationNotes: { type: String, default: "" }
  },
  { timestamps: true }
);

export type BlogVersionDocument = HydratedDocument<BlogVersion>;

export const BlogVersionModel = mongoose.model<BlogVersion>(
  "BlogVersion",
  blogVersionSchema
) as Model<BlogVersion>;
