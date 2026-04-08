# Fetch Blogs API

## API Endpoint

`GET /api/blogs`

## API Requirements

### Query Parameters

All query parameters are optional.

| Name | Type | Default | Allowed Values |
| --- | --- | --- | --- |
| `filter[approved]` | boolean string | none | `true`, `false` |
| `filter[rejected]` | boolean string | none | `true`, `false` |
| `filter[status]` | string | none | `draft`, `pending`, `approved`, `rejected` |
| `page` | number | `0` | any non-negative integer |
| `pageNo` | number | `0` | any non-negative integer |
| `limit` | number | `25` | any non-negative integer |
| `skip` | number | computed from page and limit | any non-negative integer |

### Notes

- `page` and `pageNo` are treated as the same paging input.
- If `skip` is not provided, it is calculated as `(pageNo ?? page ?? 0) * limit`.
- `filter[approved]` and `filter[rejected]` must be passed as the strings `true` or `false`.

### Example Request

```http
GET /api/blogs?filter[approved]=true&filter[status]=approved&page=0&limit=25
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
      "approved_flag": false,
      "rejected_flag": false,
      "selected_news": null,
      "source_results": [
        {
          "title": "string",
          "link": "string",
          "snippet": "string"
        }
      ],
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
