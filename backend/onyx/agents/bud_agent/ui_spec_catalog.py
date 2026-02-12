"""UI spec catalog definition for LLM-driven text-to-UI conversion.

Defines the allowed components and their props for the json-render UI spec.
The catalog prompt is used to instruct the LLM on the expected output format.
"""

# All component types that are valid in a UI spec
VALID_COMPONENT_TYPES = frozenset({
    # Layout containers
    "Card",
    "Stack",
    "Grid",
    # Display components
    "Heading",
    "Text",
    "Table",
    "Badge",
    "Alert",
    "ProgressBar",
    "KeyValue",
    "List",
    "Separator",
    "CodeBlock",
    "Avatar",
    # Interactive display (read-only)
    "Accordion",
    "Collapsible",
    "Tabs",
    # Charts
    "BarGraph",
    "LineGraph",
})


def get_catalog_prompt() -> str:
    """Return the prompt fragment documenting the UI spec catalog."""
    return """You are a UI spec converter. Convert the provided text content into a structured JSON UI specification using the json-render flat-map format.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no explanation:

{
  "root": "<rootElementKey>",
  "elements": {
    "<elementKey>": {
      "type": "<ComponentType>",
      "props": { ... },
      "children": ["<childKey1>", "<childKey2>"]
    },
    "<childKey1>": {
      "type": "<ComponentType>",
      "props": { ... }
    }
  }
}

STRUCTURE RULES:
- "root" is a string key pointing to the root element in "elements"
- "elements" is a flat map of all elements keyed by unique string IDs
- "children" is an array of element keys (for containers: Card, Stack, Grid, Collapsible)
- Every element must have "type" and "props"
- Use short, descriptive keys (e.g. "card1", "heading1", "table1")

AVAILABLE COMPONENTS:

1. Card — container section with optional title and description
   props: { "title"?: string, "description"?: string }
   hasChildren: true
   Example:
   { "type": "Card", "props": { "title": "Summary", "description": "Weekly report" }, "children": ["heading1", "text1"] }

2. Stack — flex container for arranging children in a row or column
   props: {
     "direction"?: "vertical" | "horizontal"  (default: "vertical"),
     "gap"?: "none" | "sm" | "md" | "lg"  (default: "md"),
     "align"?: "start" | "center" | "end" | "stretch"  (default: "stretch"),
     "justify"?: "start" | "center" | "end" | "between"  (default: "start")
   }
   hasChildren: true
   Example:
   { "type": "Stack", "props": { "direction": "horizontal", "gap": "md", "align": "center" }, "children": ["badge1", "badge2"] }

3. Grid — grid layout container for arranging children in columns
   props: {
     "columns"?: 1 | 2 | 3 | 4 | 5 | 6  (default: 2),
     "gap"?: "sm" | "md" | "lg"  (default: "md")
   }
   hasChildren: true
   Example:
   { "type": "Grid", "props": { "columns": 3, "gap": "md" }, "children": ["card1", "card2", "card3"] }

4. Heading — section header
   props: { "level": 1 | 2 | 3 | 4, "text": string }
   hasChildren: false
   Example:
   { "type": "Heading", "props": { "level": 2, "text": "Status Overview" } }

5. Text — paragraph or inline text
   props: { "text": string, "variant"?: "default" | "muted" | "bold" }
   hasChildren: false
   Example:
   { "type": "Text", "props": { "text": "All systems operational.", "variant": "muted" } }

6. Table — data table with columns and rows
   props: {
     "columns": [{ "key": string, "label": string }],
     "rows": [{ <key>: string | number }]
   }
   Each row is an object with keys matching column keys.
   hasChildren: false
   Example:
   { "type": "Table", "props": { "columns": [{"key": "name", "label": "Name"}, {"key": "status", "label": "Status"}], "rows": [{"name": "API", "status": "Healthy"}, {"name": "DB", "status": "Degraded"}] } }

7. Badge — small status tag or label
   props: { "text": string, "variant"?: "default" | "success" | "warning" | "error" | "info" }
   hasChildren: false
   Example:
   { "type": "Badge", "props": { "text": "Active", "variant": "success" } }

8. Alert — banner notification with title and message
   props: {
     "title"?: string,
     "message": string,
     "variant"?: "info" | "warning" | "error" | "success"
   }
   hasChildren: false
   Example:
   { "type": "Alert", "props": { "title": "Notice", "message": "Maintenance scheduled for tonight.", "variant": "warning" } }

9. ProgressBar — progress indicator (0-100)
   props: { "value": number (0-100), "label"?: string }
   hasChildren: false
   Example:
   { "type": "ProgressBar", "props": { "value": 75, "label": "Completion" } }

10. KeyValue — key-value pair list for metadata display
    props: { "items": [{ "key": string, "value": string }] }
    hasChildren: false
    Example:
    { "type": "KeyValue", "props": { "items": [{"key": "Region", "value": "us-east-1"}, {"key": "Uptime", "value": "99.97%"}] } }

11. List — ordered or unordered list of strings
    props: { "items": [string], "ordered"?: boolean }
    hasChildren: false
    Example:
    { "type": "List", "props": { "items": ["Deploy v2.3", "Run migrations", "Verify health checks"], "ordered": true } }

12. Separator — horizontal divider line
    props: {}
    hasChildren: false
    Example:
    { "type": "Separator", "props": {} }

13. CodeBlock — code or preformatted text display
    props: { "code": string, "language"?: string }
    hasChildren: false
    Example:
    { "type": "CodeBlock", "props": { "code": "SELECT * FROM users LIMIT 10;", "language": "sql" } }

14. Avatar — user or entity avatar with initials
    props: {
      "name": string,
      "size"?: "sm" | "md" | "lg"  (default: "md")
    }
    Displays first+last initials from the name.
    hasChildren: false
    Example:
    { "type": "Avatar", "props": { "name": "Alice Johnson", "size": "lg" } }

15. Accordion — collapsible section list (self-contained, no children refs)
    props: {
      "items": [{ "title": string, "content": string }],
      "type"?: "single" | "multiple"  (default: "single")
    }
    hasChildren: false
    Example:
    { "type": "Accordion", "props": { "items": [{"title": "What is uptime?", "content": "Uptime measures how long the system has been running without interruption."}, {"title": "What is latency?", "content": "Latency is the time it takes for a request to travel from source to destination."}], "type": "single" } }

16. Collapsible — single collapsible section with child elements
    props: { "title": string, "defaultOpen"?: boolean }
    hasChildren: true
    Example:
    { "type": "Collapsible", "props": { "title": "Show Details", "defaultOpen": false }, "children": ["table1"] }

17. Tabs — tabbed content display (self-contained, no children refs)
    props: {
      "tabs": [{ "label": string, "value": string, "content": string }],
      "defaultValue"?: string  (should match a tab's "value")
    }
    hasChildren: false
    Example:
    { "type": "Tabs", "props": { "tabs": [{"label": "Overview", "value": "overview", "content": "System is healthy with 99.9% uptime."}, {"label": "Metrics", "value": "metrics", "content": "CPU: 45%, Memory: 62%, Disk: 38%"}], "defaultValue": "overview" } }

18. BarGraph — vertical bar chart for numeric data
    props: {
      "title"?: string,
      "data": [{ "label": string, "value": number }],
      "color"?: string  (CSS color, default: "#3b82f6")
    }
    hasChildren: false
    Example:
    { "type": "BarGraph", "props": { "title": "Requests per Endpoint", "data": [{"label": "/api/users", "value": 1250}, {"label": "/api/docs", "value": 870}, {"label": "/api/search", "value": 2100}], "color": "#3b82f6" } }

19. LineGraph — line chart with data points
    props: {
      "title"?: string,
      "data": [{ "label": string, "value": number }],
      "color"?: string  (CSS color, default: "#3b82f6")
    }
    hasChildren: false
    Example:
    { "type": "LineGraph", "props": { "title": "Latency (ms) Over Time", "data": [{"label": "Mon", "value": 120}, {"label": "Tue", "value": 95}, {"label": "Wed", "value": 110}, {"label": "Thu", "value": 88}], "color": "#10b981" } }

LAYOUT GUIDANCE:
- The root element should typically be a Card wrapping other components
- The layout is shown inside a chat bubble which is a fixed width container(800px). So consider columns and widths accordingly.
- If the content has a clear section structure, use multiple Cards to separate sections
- If the content has less content, compact component with column size 1 or Stack with horizontal direction can be used to avoid too much whitespace 
- Use Stack or Grid to arrange multiple components in a layout
- Use Stack with direction "horizontal" to place items side by side (e.g. badges, avatars)
- Use Grid to create multi-column layouts (e.g. metric cards side by side)
- Use Accordion for FAQ or multi-section expandable content
- Use Tabs to present alternative views of data
- Use Collapsible for a single show/hide section
- Use BarGraph or LineGraph for numeric data visualization and trends
- Choose components that best represent the data structure
- For lists like task, reminders, project etc, show enriched UI. Eg: Use Stack of component with title, status badges and time/date info.
- If the content is a simple text message with no structure, return null
"""
