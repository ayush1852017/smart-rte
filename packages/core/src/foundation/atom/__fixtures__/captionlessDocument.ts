import type { SmartDocument } from "../../types.js";

/** A caption- and metadata-free document touching every block-image export path (plain, linked/aligned/licensed, decorative, inside blockquote/list/table) plus the surrounding block types. See generateCaptionlessGolden.ts. */
export const captionlessDocumentFixture: SmartDocument = {
  "type": "doc",
  "id": "doc-1",
  "children": [
    {
      "type": "heading",
      "id": "h-1",
      "attrs": {
        "level": 2
      },
      "children": [
        {
          "type": "text",
          "text": "Photos & notes"
        }
      ]
    },
    {
      "type": "paragraph",
      "id": "p-1",
      "attrs": {
        "align": "center"
      },
      "children": [
        {
          "type": "text",
          "text": "Bold ",
          "marks": [
            {
              "type": "bold"
            }
          ]
        },
        {
          "type": "text",
          "text": "link",
          "marks": [
            {
              "type": "link",
              "attrs": {
                "href": "https://example.com/a?b=1&c=2",
                "target": "_blank"
              }
            }
          ]
        },
        {
          "type": "image",
          "id": "inline-1",
          "attrs": {
            "src": "https://example.com/icon.png",
            "alt": "Icon <i>",
            "status": "ready",
            "width": 16,
            "height": 16
          }
        },
        {
          "type": "text",
          "text": " after"
        }
      ]
    },
    {
      "type": "block_image",
      "id": "img-plain",
      "attrs": {
        "src": "https://example.com/plain.png",
        "alt": "Plain photo",
        "status": "ready"
      }
    },
    {
      "type": "block_image",
      "id": "img-rich",
      "attrs": {
        "src": "https://example.com/rich.jpg",
        "alt": "A \"quoted\" photo",
        "status": "ready",
        "width": 320,
        "height": 200,
        "align": "center",
        "borderRadius": 8,
        "href": "https://example.com/source",
        "target": "_blank",
        "licenseDescription": "Sunset - CC",
        "licenseSourceUrl": "https://example.com/license",
        "licenseType": "CC BY",
        "licenseVersion": "4.0",
        "licenseAttribution": "Jane Doe"
      }
    },
    {
      "type": "block_image",
      "id": "img-decorative",
      "attrs": {
        "src": "https://example.com/rule.png",
        "alt": "",
        "decorative": true,
        "status": "ready",
        "align": "left"
      }
    },
    {
      "type": "blockquote",
      "id": "q-1",
      "children": [
        {
          "type": "paragraph",
          "id": "p-2",
          "children": [
            {
              "type": "text",
              "text": "Quoted"
            }
          ]
        },
        {
          "type": "block_image",
          "id": "img-quote",
          "attrs": {
            "src": "https://example.com/q.png",
            "alt": "In a quote",
            "status": "ready"
          }
        }
      ]
    },
    {
      "type": "list",
      "id": "l-1",
      "attrs": {
        "style": "decimal"
      },
      "children": [
        {
          "type": "list_item",
          "id": "li-1",
          "children": [
            {
              "type": "paragraph",
              "id": "p-3",
              "children": [
                {
                  "type": "text",
                  "text": "Item"
                }
              ]
            },
            {
              "type": "block_image",
              "id": "img-li",
              "attrs": {
                "src": "https://example.com/li.png",
                "alt": "In a list",
                "status": "ready",
                "width": 40,
                "height": 30
              }
            }
          ]
        }
      ]
    },
    {
      "type": "table",
      "id": "t-1",
      "attrs": {
        "caption": "A table"
      },
      "children": [
        {
          "type": "table_row",
          "id": "r-1",
          "children": [
            {
              "type": "table_cell",
              "id": "c-1",
              "attrs": {
                "rowspan": 1,
                "colspan": 1,
                "header": false
              },
              "children": [
                {
                  "type": "block_image",
                  "id": "img-td",
                  "attrs": {
                    "src": "https://example.com/td.png",
                    "alt": "In a cell",
                    "status": "ready"
                  }
                }
              ]
            },
            {
              "type": "table_cell",
              "id": "c-2",
              "attrs": {
                "rowspan": 1,
                "colspan": 1,
                "header": false
              },
              "children": [
                {
                  "type": "paragraph",
                  "id": "p-4",
                  "children": [
                    {
                      "type": "text",
                      "text": "Cell"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "block_formula",
      "id": "f-1",
      "attrs": {
        "source": "x^2",
        "notation": "latex"
      }
    },
    {
      "type": "divider",
      "id": "d-1"
    },
    {
      "type": "page_break",
      "id": "pb-1"
    },
    {
      "type": "code_block",
      "id": "code-1",
      "attrs": {
        "language": "ts"
      },
      "children": [
        {
          "type": "text",
          "text": "const a = 1 < 2;"
        }
      ]
    }
  ]
};
