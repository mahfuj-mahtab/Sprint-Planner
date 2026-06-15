export const emptyDoc = () => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const overviewTemplate = () => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Overview" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Describe what this project does, who it is for, and the problem it solves.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Goals" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Primary goal" }] }],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Scope" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", marks: [{ type: "bold" }], text: "In scope" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph" }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", marks: [{ type: "bold" }], text: "Out of scope" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph" }],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Notes" }],
    },
    { type: "paragraph" },
  ],
});

const textNode = (text) => ({ type: "text", text });

export const markdownToDoc = (markdown) => {
  const lines = String(markdown || "").split("\n");
  const content = [];
  let listItems = null;
  let listType = null;

  const flushList = () => {
    if (!listItems?.length) return;
    content.push({
      type: listType === "ordered" ? "orderedList" : "bulletList",
      content: listItems,
    });
    listItems = null;
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      content.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1].length) },
        content: [textNode(heading[2])],
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "bullet") {
        flushList();
        listType = "bullet";
        listItems = [];
      }
      listItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: [textNode(bullet[1])] }],
      });
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ordered") {
        flushList();
        listType = "ordered";
        listItems = [];
      }
      listItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: [textNode(ordered[1])] }],
      });
      continue;
    }

    flushList();
    content.push({ type: "paragraph", content: [textNode(trimmed)] });
  }

  flushList();
  if (!content.length) return emptyDoc();
  return { type: "doc", content };
};

export const slugify = (value) =>
  String(value || "page")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
