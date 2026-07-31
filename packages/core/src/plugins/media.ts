import {
  deleteInlineImage,
  insertImage,
  insertInlineImage,
  insertMedia,
  updateInlineImage,
} from "../commands/media.js";
import type { SmartRtePlugin } from "../plugin.js";

export const createMediaPlugin = (): SmartRtePlugin => ({
  id: "media",
  commands: {
    [insertImage.id]: insertImage,
    [insertInlineImage.id]: insertInlineImage,
    [deleteInlineImage.id]: deleteInlineImage,
    [updateInlineImage.id]: updateInlineImage,
    [insertMedia.id]: insertMedia,
  },
});

export const mediaPlugin = createMediaPlugin();
