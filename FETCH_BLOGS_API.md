# Fetch Blogs API

## API Endpoint

`GET /api/blogs`

## API Requirements

### Query Parameters

All query parameters are optional.

| Name | Type | Default | Allowed Values |
| --- | --- | --- | --- |
| `filter[status]` | string | none | `draft`, `pending`, `approved`, `rejected` |
| `filter[platform]` | string | none | `talent`, `hiring` |
| `page` | number | `0` | any non-negative integer |
| `pageNo` | number | `0` | any non-negative integer |
| `limit` | number | `25` | any non-negative integer |
| `skip` | number | computed from page and limit | any non-negative integer |

### Notes

- `page` and `pageNo` are treated as the same paging input.
- If `skip` is not provided, it is calculated as `(pageNo ?? page ?? 0) * limit`.
- Results are sorted by `updated_at` descending, then `created_at` and `revision`.
- `filter[platform]=talent` maps to `site = talent.zigme.in`.
- `filter[platform]=hiring` maps to `site = hiring.zigme.in`.
- Any other `filter[platform]` value leaves the list unfiltered by platform.

### Example Request

```http
GET /api/blogs?filter[status]=approved&page=0&limit=25
```

## API Response Structure

### Success Response

```json
{
  "data": [
    {
      "_id": "string",
      "site": "hiring.zigme.in",
      "prompt": "string",
      "title": "string",
      "summary": "string",
      "html_content": "string",
      "status": "pending",
      "created_at": "2026-04-08T10:00:00.000Z",
      "updated_at": "2026-04-08T10:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 0,
  "pages": 1,
  "limit": 25
}
```

### Error Response

```json
{
  "message": "string"
}
```
